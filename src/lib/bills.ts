import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Loan from "@/models/Loan";
import Account from "@/models/Account";
import User from "@/models/User";
import type { AuthUser } from "@/lib/auth-guard";
import { getCardCycleBalances } from "@/lib/credit-balance";
import { setInstallmentStatus } from "@/lib/transaction-service";
import { createRepayment } from "@/lib/loan-service";
import { dayWindow, DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";
import type { ICreditMeta } from "@/types/models";
import { Types } from "mongoose";

// Upcoming bills in one list: recurring payments (EMIs, rent), credit card
// statements and loans the user owes. Read by GET /api/integrations/bills and
// by the reminder job (bill-reminders.ts). Marking a bill paid goes through the
// same services the browser uses, so balances and ledger blocks stay right.

export type BillKind = "recurring" | "card" | "loan";
export type BillStatus = "upcoming" | "due_today" | "overdue";

export type Bill = {
  /** `recurring:<installmentId>`, `card:<accountId>:<yyyy-mm-dd of the statement close>` or `loan:<loanId>`. */
  id: string;
  kind: BillKind;
  title: string;
  /** Minor units (paise). */
  amount: number;
  currency: string;
  dueDate: string;
  /** Whole days from today in the user's time zone; negative once overdue. */
  daysUntil: number;
  status: BillStatus;
  accountId: string | null;
  /** Cards cannot be marked paid here; see markBillPaid. */
  canMarkPaid: boolean;
  recurringId?: string;
  loanId?: string;
};

export type BillServiceErrorCode = "INVALID_BILL" | "NOT_FOUND" | "NOT_PAYABLE" | "ALREADY_PAID";

export class BillServiceError extends Error {
  code: BillServiceErrorCode;
  constructor(code: BillServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BillServiceError";
  }
}

// Bills overdue by more than this are old history, not something to list.
export const OVERDUE_WINDOW_DAYS = 60;
export const DEFAULT_WINDOW_DAYS = 14;
export const MAX_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `now` to `due` on the wall clock of `timeZone`. */
export function daysUntil(due: Date, now: Date, timeZone: string): number {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const a = dayWindow(now, tz).dayStart.getTime();
  const b = dayWindow(due, tz).dayStart.getTime();
  return Math.round((b - a) / DAY_MS);
}

function statusOf(days: number): BillStatus {
  return days < 0 ? "overdue" : days === 0 ? "due_today" : "upcoming";
}

export async function getUserTimeZone(userId: string): Promise<string> {
  await connectDB();
  const doc = await User.findById(userId).select("preferences.timezone").lean<{ preferences?: { timezone?: string } } | null>();
  const tz = doc?.preferences?.timezone;
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

type TxnLite = {
  _id: { toString(): string };
  amount: number;
  currency?: string;
  date: Date;
  account: { toString(): string };
  recurringId?: { toString(): string };
  recurrenceLabel?: string;
  description?: string;
  category: string;
};

export async function listUpcomingBills(
  userId: string,
  opts: { days?: number; now?: Date; timeZone?: string } = {}
): Promise<Bill[]> {
  await connectDB();
  const now = opts.now ?? new Date();
  const days = Math.min(Math.max(Math.trunc(opts.days ?? DEFAULT_WINDOW_DAYS), 0), MAX_WINDOW_DAYS);
  const tz = opts.timeZone ?? (await getUserTimeZone(userId));
  const from = new Date(now.getTime() - OVERDUE_WINDOW_DAYS * DAY_MS);
  // Include the whole last day of the window in the user's zone.
  const to = new Date(dayWindow(new Date(now.getTime() + days * DAY_MS), tz).dayEnd.getTime() - 1);

  const bills: Bill[] = [];
  const push = (b: Omit<Bill, "daysUntil" | "status" | "dueDate"> & { due: Date }) => {
    const { due, ...rest } = b;
    const d = daysUntil(due, now, tz);
    bills.push({ ...rest, dueDate: due.toISOString(), daysUntil: d, status: statusOf(d) });
  };

  const [installments, loans, cards] = await Promise.all([
    Transaction.find({
      user: userId,
      isDeleted: { $ne: true },
      isRecurring: true,
      type: "expense",
      installmentStatus: { $in: ["upcoming", "overdue"] },
      date: { $gte: from, $lte: to },
    })
      .sort({ date: 1 })
      .limit(200)
      .lean<TxnLite[]>(),
    Loan.find({
      user: userId,
      isDeleted: { $ne: true },
      isSettled: { $ne: true },
      direction: "received",
      remainingAmount: { $gt: 0 },
      dueDate: { $gte: from, $lte: to },
    })
      .sort({ dueDate: 1 })
      .limit(100)
      .lean<Array<{ _id: { toString(): string }; counterparty: string; remainingAmount: number; currency?: string; dueDate: Date; account?: { toString(): string } }>>(),
    Account.find({
      user: userId,
      type: "credit_card",
      isDeleted: { $ne: true },
      isArchived: { $ne: true },
    }).lean<Array<{ _id: { toString(): string }; name: string; currency?: string; creditMeta?: ICreditMeta }>>(),
  ]);

  for (const t of installments) {
    push({
      id: `recurring:${t._id.toString()}`,
      kind: "recurring",
      title: t.recurrenceLabel ?? t.description ?? t.category,
      amount: t.amount,
      currency: t.currency ?? "INR",
      due: new Date(t.date),
      accountId: t.account.toString(),
      canMarkPaid: true,
      recurringId: t.recurringId?.toString(),
    });
  }

  for (const l of loans) {
    push({
      id: `loan:${l._id.toString()}`,
      kind: "loan",
      title: `Loan from ${l.counterparty}`,
      amount: l.remainingAmount,
      currency: l.currency ?? "INR",
      due: new Date(l.dueDate),
      accountId: l.account?.toString() ?? null,
      canMarkPaid: true,
      loanId: l._id.toString(),
    });
  }

  for (const card of cards) {
    const meta = card.creditMeta;
    if (!meta?.billingCycleDay || !meta?.paymentDueDay) continue;
    const { pastCycles } = await getCardCycleBalances(userId, card._id.toString(), {
      billingCycleDay: meta.billingCycleDay,
      paymentDueDay: meta.paymentDueDay,
      creditLimit: meta.creditLimit ?? 0,
      minPaymentPct: meta.minPaymentPct ?? 2,
    });
    const next = pastCycles
      .filter((c) => c.remainingDue > 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    if (!next || next.dueDate < from || next.dueDate > to) continue;
    push({
      id: `card:${card._id.toString()}:${next.periodEnd.toISOString().slice(0, 10)}`,
      kind: "card",
      title: `${card.name} payment`,
      amount: next.remainingDue,
      currency: card.currency ?? "INR",
      due: next.dueDate,
      accountId: card._id.toString(),
      canMarkPaid: false,
    });
  }

  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export async function markBillPaid(
  userId: string,
  billId: string,
  actor: AuthUser,
  opts: { amount?: number; accountId?: string; now?: Date } = {}
): Promise<{ id: string; kind: BillKind; paid: true; amount: number }> {
  await connectDB();
  const [kind, ref] = billId.split(":");

  if (kind === "recurring") {
    if (!ref || !Types.ObjectId.isValid(ref)) throw new BillServiceError("INVALID_BILL", "Invalid bill id");
    const txn = await Transaction.findOne({ _id: ref, user: userId, isDeleted: { $ne: true }, isRecurring: true }).lean<{
      amount: number;
      recurringId?: { toString(): string };
      installmentStatus?: string;
    }>();
    if (!txn?.recurringId) throw new BillServiceError("NOT_FOUND", "Bill not found");
    if (txn.installmentStatus === "paid") throw new BillServiceError("ALREADY_PAID", "This bill is already paid");
    await setInstallmentStatus(userId, txn.recurringId.toString(), ref, "paid", actor);
    return { id: billId, kind: "recurring", paid: true, amount: txn.amount };
  }

  if (kind === "loan") {
    if (!ref || !Types.ObjectId.isValid(ref)) throw new BillServiceError("INVALID_BILL", "Invalid bill id");
    const loan = await Loan.findOne({ _id: ref, user: userId, isDeleted: { $ne: true }, direction: "received" }).lean<{
      remainingAmount: number;
      isSettled?: boolean;
    }>();
    if (!loan) throw new BillServiceError("NOT_FOUND", "Bill not found");
    if (loan.isSettled || loan.remainingAmount <= 0) throw new BillServiceError("ALREADY_PAID", "This bill is already paid");
    const amount = Math.min(opts.amount ?? loan.remainingAmount, loan.remainingAmount);
    await createRepayment({
      loanId: ref,
      userId,
      actor,
      amount,
      date: opts.now ?? new Date(),
      accountId: opts.accountId,
    });
    return { id: billId, kind: "loan", paid: true, amount };
  }

  if (kind === "card") {
    throw new BillServiceError(
      "NOT_PAYABLE",
      "Card statements are paid by recording the payment on the card (a transfer from the account you paid from)"
    );
  }

  throw new BillServiceError("INVALID_BILL", "Invalid bill id");
}
