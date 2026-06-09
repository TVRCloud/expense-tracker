import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";

const updateSchema = z.object({
  counterparty: z.string().min(1).max(100).optional(),
  dueDate: z.string().optional(),
  isSettled: z.boolean().optional(),
  note: z.string().optional(),
});

type Params = Promise<{ id: string }>;

async function invalidateStatsCacheMany(userId: string, dates: Date[]) {
  if (!redis) return;
  const keys = new Set(dates.map((date) => `stats:v2:${userId}:${date.getFullYear()}:${date.getMonth() + 1}`));
  try {
    await Promise.all([...keys].map((key) => redis!.del(key)));
  } catch {
    // Redis unavailable
  }
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const loan = await Loan.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: loan });
  } catch (err) {
    logger.error({ err }, "GET /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.dueDate) update.dueDate = new Date(parsed.data.dueDate);

    await connectDB();
    const before = await Loan.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const loan = await Loan.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: update },
      { new: true }
    ).lean();

    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "loan",
      entityId: id,
      action: "update",
      before,
      after: loan,
      actor: user,
    });
    return NextResponse.json({ data: loan });
  } catch (err) {
    logger.error({ err }, "PATCH /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const loan = await Loan.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const loanBefore = loan.toObject();

    const linkedTransactions = await Transaction.find({
      user: user.id,
      isDeleted: { $ne: true },
      tags: `loan:${id}`,
    }).lean<{
      _id: unknown;
      account: unknown;
      transferTo?: unknown;
      type: string;
      amount: number;
      date: Date;
    }[]>();

    for (const txn of linkedTransactions) {
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

    await Transaction.updateMany(
      { _id: { $in: linkedTransactions.map((txn) => txn._id) }, user: user.id },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } }
    );
    for (const txn of linkedTransactions) {
      await appendLedgerBlock({
        userId: user.id,
        scope: "transaction",
        entityId: String(txn._id),
        action: "delete",
        before: txn,
        after: { ...txn, isDeleted: true },
        actor: user,
      });
    }
    const repayments = await Repayment.find({ loan: id, user: user.id, isDeleted: { $ne: true } }).lean();
    await Repayment.updateMany(
      { loan: id, user: user.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } }
    );
    for (const repayment of repayments) {
      await appendLedgerBlock({
        userId: user.id,
        scope: "repayment",
        entityId: String(repayment._id),
        action: "delete",
        before: repayment,
        after: { ...repayment, isDeleted: true },
        actor: user,
      });
    }
    const deletedLoan = await Loan.findOneAndUpdate(
      { _id: id, user: user.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } },
      { new: true }
    ).lean();
    await appendLedgerBlock({
      userId: user.id,
      scope: "loan",
      entityId: id,
      action: "delete",
      before: loanBefore,
      after: deletedLoan,
      actor: user,
    });
    await invalidateStatsCacheMany(user.id, linkedTransactions.map((txn) => new Date(txn.date)));

    return NextResponse.json({ data: { message: "Loan deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
