import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";
import { Types } from "mongoose";

const updateSchema = z.object({
  description: z.string().optional(),
  note: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  date: z.string().optional(),
});

type Params = Promise<{ id: string }>;

function hasRepaymentTag(tags?: unknown[]) {
  return (tags ?? []).some((tag) => typeof tag === "string" && tag.startsWith("repayment:"));
}

async function getLinkedTransactionBlocker(userId: string, transactionId: string, tags?: unknown[]) {
  const linkedStatement = await CreditStatement.findOne({
    user: userId,
    paymentTransactionId: transactionId,
    isDeleted: { $ne: true },
  }).select("_id").lean();
  if (linkedStatement) return "This transaction is linked to a credit statement payment.";
  if (hasRepaymentTag(tags)) return "This transaction is linked to a loan repayment.";
  return null;
}

async function invalidateStatsCache(userId: string, date: Date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  try {
    await redis?.del(`stats:v2:${userId}:${year}:${month}`);
  } catch {
    // Redis unavailable
  }
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    await connectDB();
    const txn = await Transaction.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ data: txn });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const existing = await Transaction.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean<{ date: Date; tags?: unknown[] }>();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const editBlocker = await getLinkedTransactionBlocker(user.id, id, existing.tags);
    if (editBlocker) {
      return NextResponse.json({ error: `${editBlocker} Use the linked record flow to change it.` }, { status: 409 });
    }
    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.date) update.date = new Date(parsed.data.date);

    const txn = await Transaction.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: update },
      { new: true }
    ).lean();

    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "transaction",
      entityId: id,
      action: "update",
      before: existing,
      after: txn,
      actor: user,
    });
    if (existing?.date) await invalidateStatsCache(user.id, new Date(existing.date));
    if (parsed.data.date) await invalidateStatsCache(user.id, new Date(parsed.data.date));
    return NextResponse.json({ data: txn });
  } catch (err) {
    logger.error({ err }, "PATCH /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    await connectDB();

    const txn = await Transaction.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean<{
      account: { toString(): string };
      transferTo?: { toString(): string };
      type: string;
      amount: number;
      date: Date;
      tags?: unknown[];
      recurringId?: unknown;
      installmentStatus?: string;
    }>();
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const deleteBlocker = await getLinkedTransactionBlocker(user.id, id, txn.tags);
    if (deleteBlocker) {
      return NextResponse.json({ error: `${deleteBlocker} Use the linked record flow to reverse it.` }, { status: 409 });
    }

    // Reverse account balance only for transactions that previously affected it.
    const affectsBalance = !txn.recurringId || txn.installmentStatus === "paid";
    if (affectsBalance) {
      if (txn.type === "transfer") {
        const accountBefore = await Account.findOne({ _id: txn.account, user: user.id });
        const accountAfter = await Account.findOneAndUpdate(
          { _id: txn.account, user: user.id },
          { $inc: { balance: txn.amount } },
          { new: true }
        );
        if (accountBefore && accountAfter) {
          await appendLedgerBlock({
            userId: user.id,
            scope: "account",
            entityId: accountAfter._id.toString(),
            action: "update",
            before: accountBefore,
            after: accountAfter,
            actor: user,
          });
        }
        if (txn.transferTo) {
          const transferBefore = await Account.findOne({ _id: txn.transferTo, user: user.id });
          const transferAfter = await Account.findOneAndUpdate(
            { _id: txn.transferTo, user: user.id },
            { $inc: { balance: -txn.amount } },
            { new: true }
          );
          if (transferBefore && transferAfter) {
            await appendLedgerBlock({
              userId: user.id,
              scope: "account",
              entityId: transferAfter._id.toString(),
              action: "update",
              before: transferBefore,
              after: transferAfter,
              actor: user,
            });
          }
        }
      } else {
        const balanceDelta = txn.type === "income" ? -txn.amount : txn.amount;
        const accountBefore = await Account.findOne({ _id: txn.account, user: user.id });
        const accountAfter = await Account.findOneAndUpdate(
          { _id: txn.account, user: user.id },
          { $inc: { balance: balanceDelta } },
          { new: true }
        );
        if (accountBefore && accountAfter) {
          await appendLedgerBlock({
            userId: user.id,
            scope: "account",
            entityId: accountAfter._id.toString(),
            action: "update",
            before: accountBefore,
            after: accountAfter,
            actor: user,
          });
        }
      }
    }
    const deleted = await Transaction.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } },
      { new: true }
    ).lean();
    await appendLedgerBlock({
      userId: user.id,
      scope: "transaction",
      entityId: id,
      action: "delete",
      before: txn,
      after: deleted,
      actor: user,
    });
    await invalidateStatsCache(user.id, new Date(txn.date));

    return NextResponse.json({ data: { message: "Transaction deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
