import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";

// Shared loan-repayment business logic, used by both the browser-facing
// POST /api/loans/[id]/repayments route and the n8n-facing
// POST /api/integrations/sms route (EMI-payment SMS auto-matched to a loan).
// Do not duplicate this logic in either caller — extend it here instead,
// same convention as transaction-service.ts.

export class LoanServiceError extends Error {
  code: "NOT_FOUND" | "ACCOUNT_NOT_FOUND";
  constructor(code: "NOT_FOUND" | "ACCOUNT_NOT_FOUND", message: string) {
    super(message);
    this.code = code;
  }
}

async function invalidateStatsCache(userId: string, date: Date) {
  try {
    await redis?.del(`stats:v2:${userId}:${date.getFullYear()}:${date.getMonth() + 1}`);
  } catch {
    // Redis unavailable
  }
}

export async function createRepayment(params: {
  loanId: string;
  userId: string;
  actor: AuthUser;
  amount: number; // cents
  date: Date;
  note?: string;
  accountId?: string;
}) {
  const { loanId, userId, actor, amount, date, note, accountId } = params;
  await connectDB();

  const loan = await Loan.findOne({ _id: loanId, user: userId, isDeleted: { $ne: true } }).lean<{
    _id: { toString(): string };
    remainingAmount: number;
    direction: "given" | "received";
    counterparty: string;
    currency?: string;
  }>();
  if (!loan) throw new LoanServiceError("NOT_FOUND", "Loan not found");

  if (accountId) {
    const account = await Account.findOne({ _id: accountId, user: userId, isArchived: false });
    if (!account) throw new LoanServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  }

  const newRemaining = Math.max(0, loan.remainingAmount - amount);
  const isSettled = newRemaining === 0;

  const updatedLoan = await Loan.findByIdAndUpdate(
    loanId,
    {
      $set: {
        remainingAmount: newRemaining,
        isSettled,
        ...(isSettled ? { settledAt: date } : { settledAt: undefined }),
      },
    },
    { new: true }
  );
  await appendLedgerBlock({
    userId,
    scope: "loan",
    entityId: loanId,
    action: "update",
    before: loan,
    after: updatedLoan,
    actor,
  });

  const repayment = await Repayment.create({
    loan: loanId,
    user: userId,
    amount,
    date,
    note,
    account: accountId,
  });
  await appendLedgerBlock({
    userId,
    scope: "repayment",
    entityId: repayment._id.toString(),
    action: "create",
    after: repayment,
    actor,
  });

  let transaction = null;
  if (accountId) {
    const type = loan.direction === "given" ? "income" : "expense";
    const balanceDelta = type === "income" ? amount : -amount;
    const accountBefore = await Account.findOne({ _id: accountId, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: accountId, user: userId },
      { $inc: { balance: balanceDelta } },
      { new: true }
    );
    if (accountBefore && accountAfter) {
      await appendLedgerBlock({
        userId,
        scope: "account",
        entityId: accountAfter._id.toString(),
        action: "update",
        before: accountBefore,
        after: accountAfter,
        actor,
      });
    }
    transaction = await Transaction.create({
      user: userId,
      account: accountId,
      type,
      amount,
      currency: loan.currency ?? "INR",
      category: "loan_repayment",
      description: loan.direction === "given"
        ? `Repayment from ${loan.counterparty}`
        : `Repayment to ${loan.counterparty}`,
      note,
      date,
      tags: [`loan:${loanId}`, `repayment:${repayment._id.toString()}`],
    });
    await appendLedgerBlock({
      userId,
      scope: "transaction",
      entityId: transaction._id.toString(),
      action: "create",
      after: transaction,
      actor,
    });
    await invalidateStatsCache(userId, date);
  }

  return { repayment, isSettled, transaction };
}
