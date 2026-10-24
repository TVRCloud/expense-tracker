import { z } from "zod";
import connectDB from "@/lib/mongodb";
import SinkingFund from "@/models/SinkingFund";
import Notification from "@/models/Notification";
import logger from "@/lib/logger";
import { lockBaseCurrency } from "@/lib/base-currency";

// Sinking funds: money put aside each month for a cost with a due date.
// Shared by the browser routes (/api/sinking-funds) and the integration
// routes (/api/integrations/sinking-funds). Reads add computed fields (see
// describeFund) so clients show the same numbers without redoing the maths.

// Far past any real figure, and keeps the arithmetic below safely inside what a double can hold.
export const MAX_FUND_AMOUNT = 100_000_000_000_000; // 1e14 paise

const dateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Enter a valid date");

export const sinkingFundCreateSchema = z.object({
  name: z.string().min(1, "Name your fund").max(100),
  targetAmount: z.number().int().positive("Enter a target greater than 0").max(MAX_FUND_AMOUNT),
  savedAmount: z.number().int().min(0).max(MAX_FUND_AMOUNT).default(0),
  dueDate: dateString,
  monthlyAmount: z.number().int().positive().max(MAX_FUND_AMOUNT).optional(),
  icon: z.string().max(16).optional(),
});

export const sinkingFundUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    targetAmount: z.number().int().positive().max(MAX_FUND_AMOUNT).optional(),
    dueDate: dateString.optional(),
    // null clears the plan so the suggested amount applies again.
    monthlyAmount: z.number().int().positive().max(MAX_FUND_AMOUNT).nullable().optional(),
    icon: z.string().max(16).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

// Negative takes money out (a spend from the fund); the balance never goes
// below zero.
export const sinkingFundContributeSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-MAX_FUND_AMOUNT)
    .max(MAX_FUND_AMOUNT)
    .refine((v) => v !== 0, "Amount cannot be 0"),
});

export class SinkingFundError extends Error {
  code: "FUND_NOT_FOUND" | "FUND_LIMIT";
  constructor(message = "Sinking fund not found", code: "FUND_NOT_FOUND" | "FUND_LIMIT" = "FUND_NOT_FOUND") {
    super(message);
    this.code = code;
    this.name = "SinkingFundError";
  }
}

export type FundStatus = "done" | "on_track" | "behind" | "overdue";

export interface FundRecord {
  _id: unknown;
  name: string;
  targetAmount: number;
  savedAmount: number;
  currency?: string;
  dueDate: Date;
  monthlyAmount?: number | null;
  icon?: string | null;
  isCompleted?: boolean;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface FundView {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  currency: string;
  dueDate: string;
  monthlyAmount: number | null;
  icon: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** Still to save, never below 0. */
  remaining: number;
  /** Whole percent saved, capped at 100. */
  percent: number;
  /** Whole months from the current month to the due month (0 in the due month or later). */
  monthsLeft: number;
  /** What would reach the target by the due date: remaining spread over the months left (all of it when none are left). */
  suggestedMonthly: number;
  status: FundStatus;
}

// Calendar months between "now" and the due date, counted month to month so
// a fund due on the 5th of next month has 1 month left from the 20th of this
// one, and 0 once the due month is reached.
export function monthsUntil(due: Date, now: Date): number {
  const diff = (due.getUTCFullYear() - now.getUTCFullYear()) * 12 + (due.getUTCMonth() - now.getUTCMonth());
  return Math.max(0, diff);
}

// Pure: the same fund and clock always give the same view.
//   done      saved >= target
//   overdue   due date passed and not done
//   on_track  saved >= what a straight line from creation to the due date
//             would have by now
//   behind    otherwise
export function describeFund(fund: FundRecord, now: Date = new Date()): FundView {
  const due = new Date(fund.dueDate);
  const created = new Date(fund.createdAt);
  const remaining = Math.max(0, fund.targetAmount - fund.savedAmount);
  const percent = fund.targetAmount > 0 ? Math.min(100, Math.floor((fund.savedAmount / fund.targetAmount) * 100)) : 0;
  const monthsLeft = monthsUntil(due, now);
  const suggestedMonthly = remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft));

  let status: FundStatus;
  if (fund.savedAmount >= fund.targetAmount) {
    status = "done";
  } else if (due.getTime() < now.getTime()) {
    status = "overdue";
  } else {
    const total = due.getTime() - created.getTime();
    const elapsed = Math.min(Math.max(now.getTime() - created.getTime(), 0), Math.max(total, 0));
    const expected = total > 0 ? Math.round(fund.targetAmount * (elapsed / total)) : fund.targetAmount;
    status = fund.savedAmount >= expected ? "on_track" : "behind";
  }

  return {
    id: String(fund._id),
    name: fund.name,
    targetAmount: fund.targetAmount,
    savedAmount: fund.savedAmount,
    currency: fund.currency ?? "INR",
    dueDate: due.toISOString(),
    monthlyAmount: fund.monthlyAmount ?? null,
    icon: fund.icon ?? null,
    isCompleted: fund.savedAmount >= fund.targetAmount,
    completedAt: fund.completedAt ? new Date(fund.completedAt).toISOString() : null,
    createdAt: created.toISOString(),
    updatedAt: fund.updatedAt ? new Date(fund.updatedAt).toISOString() : null,
    remaining,
    percent,
    monthsLeft,
    suggestedMonthly,
    status,
  };
}

export interface FundTotals {
  count: number;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  /** What to put aside this month across the funds that are not done: each fund's own plan, else its suggestion. */
  monthlyNeeded: number;
}

export function totalFunds(funds: FundView[]): FundTotals {
  const open = funds.filter((f) => f.status !== "done");
  return {
    count: funds.length,
    targetAmount: funds.reduce((s, f) => s + f.targetAmount, 0),
    savedAmount: funds.reduce((s, f) => s + f.savedAmount, 0),
    remaining: funds.reduce((s, f) => s + f.remaining, 0),
    monthlyNeeded: open.reduce((s, f) => s + (f.monthlyAmount ?? f.suggestedMonthly), 0),
  };
}

const notDeleted = { isDeleted: { $ne: true } };

export async function listSinkingFunds(userId: string, now: Date = new Date()) {
  await connectDB();
  const docs = await SinkingFund.find({ user: userId, ...notDeleted })
    .sort({ dueDate: 1, createdAt: 1 })
    .lean<FundRecord[]>();
  const funds = docs.map((d) => describeFund(d, now));
  return { funds, totals: totalFunds(funds) };
}

export async function getSinkingFund(userId: string, id: string, now: Date = new Date()) {
  await connectDB();
  const doc = await SinkingFund.findOne({ _id: id, user: userId, ...notDeleted }).lean<FundRecord>();
  if (!doc) throw new SinkingFundError();
  return describeFund(doc, now);
}

export type CreateSinkingFundInput = z.infer<typeof sinkingFundCreateSchema> & { userId: string };

export async function createSinkingFund(input: CreateSinkingFundInput, now: Date = new Date()) {
  const { userId, dueDate, ...rest } = input;
  await connectDB();
  await lockBaseCurrency(userId);
  const reached = rest.savedAmount >= rest.targetAmount;
  const doc = await SinkingFund.create({
    ...rest,
    user: userId,
    dueDate: new Date(dueDate),
    isCompleted: reached,
    completedAt: reached ? now : undefined,
  });
  return describeFund(doc.toObject() as FundRecord, now);
}

export type UpdateSinkingFundInput = z.infer<typeof sinkingFundUpdateSchema> & { userId: string; fundId: string };

// completedAt follows isCompleted inside the same update: kept if the fund was already complete, stamped now when
// it becomes complete, removed when it is not complete any more.
// A pipeline update skips Mongoose's timestamps, so updatedAt is set here.
const completionStages = (now: Date) => [
  { $set: { updatedAt: now } },
  { $set: { isCompleted: { $gte: ["$savedAmount", "$targetAmount"] } } },
  { $set: { completedAt: { $cond: ["$isCompleted", { $ifNull: ["$completedAt", now] }, "$$REMOVE"] } } },
];

// The answer to a write is built from the document the update saw plus what the update applied, so nothing that
// can fail runs after the money or the edit is stored: a retry under the same Idempotency-Key must not repeat a
// write that already happened.
export async function updateSinkingFund(input: UpdateSinkingFundInput, now: Date = new Date()) {
  const { userId, fundId, ...changes } = input;
  await connectDB();
  const filter = { _id: fundId, user: userId, ...notDeleted };

  // Strings go in as $literal so a name that starts with "$" is not read as a field path.
  const set: Record<string, unknown> = {};
  if (changes.name !== undefined) set.name = { $literal: changes.name };
  if (changes.targetAmount !== undefined) set.targetAmount = changes.targetAmount;
  if (changes.dueDate !== undefined) set.dueDate = new Date(changes.dueDate);
  if (changes.icon !== undefined) set.icon = { $literal: changes.icon };
  if (changes.monthlyAmount !== undefined && changes.monthlyAmount !== null) set.monthlyAmount = changes.monthlyAmount;
  const stages: Record<string, unknown>[] = [];
  if (Object.keys(set).length > 0) stages.push({ $set: set });
  if (changes.monthlyAmount === null) stages.push({ $unset: "monthlyAmount" });
  stages.push(...completionStages(now));

  // The update returns the document as it was just before it ran, so "did this change complete the fund" is
  // decided by the same atomic step that completed it: two writers cannot both see "not complete yet".
  const before = await SinkingFund.findOneAndUpdate(filter, stages, { returnDocument: "before", updatePipeline: true }).lean<FundRecord>();
  if (!before) throw new SinkingFundError();

  const target = changes.targetAmount ?? before.targetAmount;
  const isCompleted = before.savedAmount >= target;
  const after: FundRecord = {
    ...before,
    name: changes.name ?? before.name,
    targetAmount: target,
    dueDate: changes.dueDate !== undefined ? new Date(changes.dueDate) : before.dueDate,
    icon: changes.icon ?? before.icon,
    monthlyAmount: changes.monthlyAmount === undefined ? before.monthlyAmount : (changes.monthlyAmount ?? undefined),
    isCompleted,
    completedAt: isCompleted ? (before.completedAt ?? now) : undefined,
    updatedAt: now,
  };
  if (!before.isCompleted && isCompleted) await notifyReached(userId, after);
  return describeFund(after, now);
}

// Adds to (or takes from) the balance atomically, so two phones saving at once
// both count. The balance is floored at 0. A deposit that would pass
// MAX_FUND_AMOUNT is refused (the guard sits in the update's filter, so it
// holds under concurrency) rather than quietly capped. The update hands back
// the document as it was, so the alert for reaching the target is sent by
// exactly the contribution that crossed it.
export async function contributeToSinkingFund(
  input: { userId: string; fundId: string; amount: number },
  now: Date = new Date()
) {
  const { userId, fundId, amount } = input;
  await connectDB();
  const filter = { _id: fundId, user: userId, ...notDeleted };
  const before = await SinkingFund.findOneAndUpdate(
    { ...filter, $expr: { $lte: [{ $add: ["$savedAmount", amount] }, MAX_FUND_AMOUNT] } },
    [{ $set: { savedAmount: { $max: [0, { $add: ["$savedAmount", amount] }] } } }, ...completionStages(now)],
    { returnDocument: "before", updatePipeline: true }
  ).lean<FundRecord>();
  if (!before) {
    // Nothing matched: either there is no such fund, or the deposit would pass the limit.
    const exists = await SinkingFund.exists(filter);
    if (exists) throw new SinkingFundError(`A fund can hold at most ${MAX_FUND_AMOUNT / 100} rupees`, "FUND_LIMIT");
    throw new SinkingFundError();
  }

  const savedAmount = Math.max(0, before.savedAmount + amount);
  const isCompleted = savedAmount >= before.targetAmount;
  const after: FundRecord = {
    ...before,
    savedAmount,
    isCompleted,
    completedAt: isCompleted ? (before.completedAt ?? now) : undefined,
    updatedAt: now,
  };
  if (!before.isCompleted && isCompleted) await notifyReached(userId, after);
  return describeFund(after, now);
}

export async function deleteSinkingFund(userId: string, fundId: string) {
  await connectDB();
  const filter = { _id: fundId, user: userId, ...notDeleted };
  const doc = await SinkingFund.findOneAndUpdate(
    filter,
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  if (!doc) throw new SinkingFundError();
}

// Best effort: the fund is already saved, so a failed alert is logged and never undoes or fails the write.
async function notifyReached(userId: string, fund: FundRecord) {
  try {
    await Notification.create({
      user: userId,
      type: "goal_reached",
      title: "Fund fully saved",
      body: `Your "${fund.name}" fund has reached its target.`,
      meta: { sinkingFundId: String(fund._id) },
    });
  } catch (err) {
    logger.error({ err, fundId: String(fund._id) }, "sinking fund goal_reached alert failed");
  }
}
