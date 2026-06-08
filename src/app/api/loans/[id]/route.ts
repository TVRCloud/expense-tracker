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
    const loan = await Loan.findOne({ _id: id, user: user.id }).lean();
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
    const loan = await Loan.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: update },
      { new: true }
    ).lean();

    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    const loan = await Loan.findOne({ _id: id, user: user.id });
    if (!loan) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const linkedTransactions = await Transaction.find({
      user: user.id,
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

    await Transaction.deleteMany({ _id: { $in: linkedTransactions.map((txn) => txn._id) }, user: user.id });
    await Repayment.deleteMany({ loan: id, user: user.id });
    await Loan.deleteOne({ _id: id, user: user.id });
    await invalidateStatsCacheMany(user.id, linkedTransactions.map((txn) => new Date(txn.date)));

    return NextResponse.json({ data: { message: "Loan deleted" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/loans/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
