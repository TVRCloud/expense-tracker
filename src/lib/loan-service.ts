import { deleteReceiptsOfTransactions } from "@/lib/receipt-service";
import connectDB from "@/lib/mongodb";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { redis } from "@/lib/redis";
import { appendLedgerBlock } from "@/lib/ledger";
import { z } from "zod";

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

async function invalidateStatsCacheMany(userId: string, dates: Date[]) {
  if (!redis) return;
  const keys = new Set(dates.map((date) => `stats:v2:${userId}:${date.getFullYear()}:${date.getMonth() + 1}`));
  try {
    await Promise.all([...keys].map((key) => redis!.del(key)));
  } catch {
    // Redis unavailable
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

export const loanCreateSchema = z.object({
  direction: z.enum(["given", "received"]),
  counterparty: z.string().min(1).max(100),
  principalAmount: z.number().int().positive(),
  currency: z.string().default("INR"),
  interestRate: z.number().min(0).max(100).default(0),
  startDate: z.string(),
  dueDate: z.string().optional(),
  note: z.string().optional(),
  accountId: z.string().optional(),
  externalLoanId: z.string().max(64).optional(),
});

export const loanUpdateSchema = z.object({
  counterparty: z.string().min(1).max(100).optional(),
  dueDate: z.string().optional(),
  isSettled: z.boolean().optional(),
  description: z.string().optional(),
  interestRate: z.number().min(0).max(100).optional(),
  externalLoanId: z.string().max(64).optional(),
});

export const repaymentCreateSchema = z.object({
  amount: z.number().int().positive(),
  date: z.string(),
  note: z.string().optional(),
  accountId: z.string().optional(),
});

export async function listLoans(userId: string, filters: { direction?: string | null; isSettled?: string | null } = {}) {
  const query: Record<string, unknown> = { user: userId, isDeleted: { $ne: true } };
  if (filters.direction) query.direction = filters.direction;
  if (filters.isSettled !== null && filters.isSettled !== undefined) query.isSettled = filters.isSettled === "true";
  await connectDB();
  return Loan.find(query).sort({ createdAt: -1 }).lean();
}

export async function getLoan(userId: string, loanId: string) {
  await connectDB();
  const loan = await Loan.findOne({ _id: loanId, user: userId, isDeleted: { $ne: true } }).lean();
  if (!loan) throw new LoanServiceError("NOT_FOUND", "Loan not found");
  return loan;
}

export async function listRepayments(userId: string, loanId: string) {
  await getLoan(userId, loanId);
  return Repayment.find({ loan: loanId, user: userId, isDeleted: { $ne: true } })
    .sort({ date: -1 })
    .lean();
}

export type CreateLoanInput = z.infer<typeof loanCreateSchema> & { userId: string; actor: AuthUser };

// Shared with POST /api/loans (browser) and the integration route. With an
// accountId it also books the principal as a transaction and moves the balance.
export async function createLoan(input: CreateLoanInput) {
  const { userId, actor, accountId, ...loanData } = input;
  await connectDB();

  if (accountId) {
    const account = await Account.findOne({ _id: accountId, user: userId, isArchived: false });
    if (!account) throw new LoanServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  }

  const loan = await Loan.create({
    ...loanData,
    user: userId,
    account: accountId,
    remainingAmount: loanData.principalAmount,
    startDate: new Date(loanData.startDate),
    dueDate: loanData.dueDate ? new Date(loanData.dueDate) : undefined,
  });
  await appendLedgerBlock({ userId, scope: "loan", entityId: loan._id.toString(), action: "create", after: loan, actor });

  if (accountId) {
    const transactionDate = new Date(loanData.startDate);
    const type = loanData.direction === "received" ? "income" : "expense";
    const balanceDelta = type === "income" ? loanData.principalAmount : -loanData.principalAmount;

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
    const transaction = await Transaction.create({
      user: userId,
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
      userId,
      scope: "transaction",
      entityId: transaction._id.toString(),
      action: "create",
      after: transaction,
      actor,
    });
    await invalidateStatsCache(userId, transactionDate);
  }

  return loan;
}

export type UpdateLoanInput = z.infer<typeof loanUpdateSchema> & { userId: string; loanId: string; actor: AuthUser };

// Shared with PATCH /api/loans/[id] (browser) and the integration route.
export async function updateLoan(input: UpdateLoanInput) {
  const { userId, loanId, actor, ...changes } = input;
  const update: Record<string, unknown> = { ...changes };
  if (changes.dueDate) update.dueDate = new Date(changes.dueDate);

  await connectDB();
  const filter = { _id: loanId, user: userId, isDeleted: { $ne: true } };
  const before = await Loan.findOne(filter).lean();
  if (!before) throw new LoanServiceError("NOT_FOUND", "Loan not found");
  const loan = await Loan.findOneAndUpdate(filter, { $set: update }, { new: true }).lean();
  if (!loan) throw new LoanServiceError("NOT_FOUND", "Loan not found");

  await appendLedgerBlock({ userId, scope: "loan", entityId: loanId, action: "update", before, after: loan, actor });
  return loan;
}

// Soft delete, shared with DELETE /api/loans/[id] and the integration route.
// Reverses the balance effect of every linked transaction, then soft deletes
// those transactions, the repayments and the loan.
export async function deleteLoan(userId: string, loanId: string, actor: AuthUser) {
  await connectDB();
  const loan = await Loan.findOne({ _id: loanId, user: userId, isDeleted: { $ne: true } });
  if (!loan) throw new LoanServiceError("NOT_FOUND", "Loan not found");
  const loanBefore = loan.toObject();

  const linkedTransactions = await Transaction.find({
    user: userId,
    isDeleted: { $ne: true },
    tags: `loan:${loanId}`,
  }).lean<{
    _id: unknown;
    account: unknown;
    transferTo?: unknown;
    type: string;
    amount: number;
    date: Date;
  }[]>();

  async function adjustBalance(accountId: unknown, delta: number) {
    const accountBefore = await Account.findOne({ _id: accountId, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: accountId, user: userId },
      { $inc: { balance: delta } },
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
  }

  for (const txn of linkedTransactions) {
    if (txn.type === "transfer") {
      await adjustBalance(txn.account, txn.amount);
      if (txn.transferTo) await adjustBalance(txn.transferTo, -txn.amount);
    } else {
      await adjustBalance(txn.account, txn.type === "income" ? -txn.amount : txn.amount);
    }
  }

  await Transaction.updateMany(
    { _id: { $in: linkedTransactions.map((txn) => txn._id) }, user: userId },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } }
  );
  await deleteReceiptsOfTransactions(userId, linkedTransactions.map((txn) => txn._id));
  for (const txn of linkedTransactions) {
    await appendLedgerBlock({
      userId,
      scope: "transaction",
      entityId: String(txn._id),
      action: "delete",
      before: txn,
      after: { ...txn, isDeleted: true },
      actor,
    });
  }
  const repayments = await Repayment.find({ loan: loanId, user: userId, isDeleted: { $ne: true } }).lean();
  await Repayment.updateMany(
    { loan: loanId, user: userId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } }
  );
  for (const repayment of repayments) {
    await appendLedgerBlock({
      userId,
      scope: "repayment",
      entityId: String(repayment._id),
      action: "delete",
      before: repayment,
      after: { ...repayment, isDeleted: true },
      actor,
    });
  }
  const deletedLoan = await Loan.findOneAndUpdate(
    { _id: loanId, user: userId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  await appendLedgerBlock({
    userId,
    scope: "loan",
    entityId: loanId,
    action: "delete",
    before: loanBefore,
    after: deletedLoan,
    actor,
  });
  await invalidateStatsCacheMany(userId, linkedTransactions.map((txn) => new Date(txn.date)));
}
