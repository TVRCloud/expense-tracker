import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";

const createSchema = z.object({
  direction: z.enum(["given", "received"]),
  counterparty: z.string().min(1).max(100),
  principalAmount: z.number().int().positive(),
  currency: z.string().default("INR"),
  interestRate: z.number().min(0).max(100).default(0),
  startDate: z.string(),
  dueDate: z.string().optional(),
  note: z.string().optional(),
  accountId: z.string().optional(),
});

async function invalidateStatsCache(userId: string, date: Date) {
  try {
    await redis?.del(`stats:v2:${userId}:${date.getFullYear()}:${date.getMonth() + 1}`);
  } catch {
    // Redis unavailable
  }
}

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const direction = searchParams.get("direction");
    const isSettled = searchParams.get("isSettled");

    const query: Record<string, unknown> = { user: user.id, isDeleted: { $ne: true } };
    if (direction) query.direction = direction;
    if (isSettled !== null) query.isSettled = isSettled === "true";

    await connectDB();
    const loans = await Loan.find(query).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ data: loans });
  } catch (err) {
    logger.error({ err }, "GET /api/loans failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const { accountId, ...loanData } = parsed.data;
    await connectDB();

    if (accountId) {
      const account = await Account.findOne({ _id: accountId, user: user.id, isArchived: false });
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const loan = await Loan.create({
      ...loanData,
      user: user.id,
      account: accountId,
      remainingAmount: loanData.principalAmount,
      startDate: new Date(loanData.startDate),
      dueDate: loanData.dueDate ? new Date(loanData.dueDate) : undefined,
    });
    await appendLedgerBlock({
      userId: user.id,
      scope: "loan",
      entityId: loan._id.toString(),
      action: "create",
      after: loan,
      actor: user,
    });

    if (accountId) {
      const transactionDate = new Date(loanData.startDate);
      const type = loanData.direction === "received" ? "income" : "expense";
      const balanceDelta = type === "income" ? loanData.principalAmount : -loanData.principalAmount;

      const accountBefore = await Account.findOne({ _id: accountId, user: user.id });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: accountId, user: user.id },
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
      const transaction = await Transaction.create({
        user: user.id,
        account: accountId,
        type,
        amount: loanData.principalAmount,
        currency: loanData.currency,
        category: "loan",
        description: loanData.direction === "received"
          ? `Borrowed from ${loanData.counterparty}`
          : `Lent to ${loanData.counterparty}`,
        note: loanData.note,
        date: transactionDate,
        tags: [`loan:${loan._id.toString()}`, "loan_principal"],
      });
      await appendLedgerBlock({
        userId: user.id,
        scope: "transaction",
        entityId: transaction._id.toString(),
        action: "create",
        after: transaction,
        actor: user,
      });
      await invalidateStatsCache(user.id, transactionDate);
    }

    return NextResponse.json({ data: loan }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/loans failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
