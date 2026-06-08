import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { redis } from "@/lib/redis";

const updateSchema = z.object({
  description: z.string().optional(),
  note: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  date: z.string().optional(),
});

type Params = Promise<{ id: string }>;

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
    await connectDB();
    const txn = await Transaction.findOne({ _id: id, user: user.id }).lean();
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
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const existing = await Transaction.findOne({ _id: id, user: user.id }).lean<{ date: Date }>();
    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.date) update.date = new Date(parsed.data.date);

    const txn = await Transaction.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: update },
      { new: true }
    ).lean();

    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    await connectDB();

    const txn = await Transaction.findOne({ _id: id, user: user.id }).lean<{
      account: { toString(): string };
      transferTo?: { toString(): string };
      type: string;
      amount: number;
      date: Date;
      recurringId?: unknown;
      installmentStatus?: string;
    }>();
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Reverse account balance only for transactions that previously affected it.
    const affectsBalance = !txn.recurringId || txn.installmentStatus === "paid";
    if (affectsBalance) {
      if (txn.type === "transfer") {
        await Account.findOneAndUpdate(
          { _id: txn.account, user: user.id },
          { $inc: { balance: txn.amount } }
        );
        if (txn.transferTo) {
          await Account.findOneAndUpdate(
            { _id: txn.transferTo, user: user.id },
            { $inc: { balance: -txn.amount } }
          );
        }
      } else {
        const balanceDelta = txn.type === "income" ? -txn.amount : txn.amount;
        await Account.findOneAndUpdate(
          { _id: txn.account, user: user.id },
          { $inc: { balance: balanceDelta } }
        );
      }
    }
    await Transaction.deleteOne({ _id: id, user: user.id });
    await invalidateStatsCache(user.id, new Date(txn.date));

    return NextResponse.json({ data: { message: "Transaction deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
