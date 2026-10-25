import { z } from "zod";
import connectDB from "@/lib/mongodb";
import EnvelopePlan from "@/models/EnvelopePlan";
import Budget from "@/models/Budget";
import User from "@/models/User";
import { spentByCategory } from "@/lib/budget-service";
import { getBaseState, lockBaseCurrency } from "@/lib/base-currency";
import { BASE_CURRENCY_ONLY_TWO_DECIMALS, MAX_MINOR_AMOUNT, isSupportedAsBase, minorExponent } from "@/lib/currency";
import { DEFAULT_TIME_ZONE, isValidTimeZone, localDate } from "@/lib/spend-limit-time";

// Envelope mode: optional zero-based budgeting on top of budgets. Each month
// the person states the income they expect and gives it away by assigning
// amounts to envelopes (a budget category each). What is left unassigned is
// shown, never forced to zero. Shared by the browser routes (/api/envelopes)
// and the integration routes (/api/integrations/envelopes).
//
// Every write is ONE atomic update on the month's single document (a pipeline
// update with the guards in its filter), so two requests at once cannot both
// spend the same money and no multi-document transaction is needed.

export const MAX_ENVELOPES = 60;
export const MAX_MOVES = 50;
const MOVES_SHOWN = 20;

// ── input ──────────────────────────────────────────────────────────────────

const monthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-10")
  .refine((m) => Number(m.slice(0, 4)) >= 2000 && Number(m.slice(0, 4)) <= 2100, "Month is out of range");
const category = z.string().trim().min(1, "Name the envelope").max(100);
const paise = z.number().int().min(0).max(MAX_MINOR_AMOUNT);

export const envelopeAssignSchema = z
  .object({
    month: monthString,
    income: paise.optional(),
    // Set the amount for these envelopes (created when new).
    assign: z.array(z.object({ category, assigned: paise }).strict()).max(MAX_ENVELOPES).optional(),
    // Take these envelopes out of the plan.
    remove: z.array(category).max(MAX_ENVELOPES).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.income === undefined && !d.assign?.length && !d.remove?.length) {
      ctx.addIssue({ code: "custom", message: "Send income, assign or remove" });
    }
    const seen = new Set<string>();
    for (const [i, a] of (d.assign ?? []).entries()) {
      if (seen.has(a.category)) ctx.addIssue({ code: "custom", path: ["assign", i, "category"], message: "Each envelope once" });
      seen.add(a.category);
    }
    for (const [i, r] of (d.remove ?? []).entries()) {
      if (seen.has(r)) ctx.addIssue({ code: "custom", path: ["remove", i], message: "An envelope cannot be assigned and removed at once" });
    }
  });
export type EnvelopeAssignInput = z.infer<typeof envelopeAssignSchema>;

export const envelopeMoveSchema = z
  .object({
    month: monthString,
    from: category,
    to: category,
    amount: z.number().int().min(1).max(MAX_MINOR_AMOUNT),
    // Allow taking money that is already spent (the envelope may end up overspent).
    allowOverdraw: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.from !== d.to, { message: "Pick two different envelopes" });
export type EnvelopeMoveInput = z.infer<typeof envelopeMoveSchema>;

export const envelopeCopySchema = z
  .object({ month: monthString, from: monthString.optional() })
  .strict()
  .refine((d) => d.from === undefined || d.from !== d.month, { message: "Copy from a different month" });
export type EnvelopeCopyInput = z.infer<typeof envelopeCopySchema>;

export const envelopeSettingsSchema = z.object({ enabled: z.boolean() }).strict();

// ── errors ─────────────────────────────────────────────────────────────────

export type EnvelopeErrorCode =
  | "ENVELOPES_DISABLED"
  | "ENVELOPE_NOT_FOUND"
  | "INSUFFICIENT"
  | "TOO_MANY"
  | "PLAN_NOT_EMPTY"
  | "NOTHING_TO_COPY"
  | "BASE_CURRENCY_ONLY_TWO_DECIMALS";

export class EnvelopeError extends Error {
  code: EnvelopeErrorCode;
  constructor(code: EnvelopeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EnvelopeError";
  }
}

/** HTTP status for the browser routes; the integration routes map the same codes to their own error codes. */
export const ENVELOPE_ERROR_STATUS: Record<EnvelopeErrorCode, number> = {
  ENVELOPES_DISABLED: 409,
  ENVELOPE_NOT_FOUND: 404,
  INSUFFICIENT: 400,
  TOO_MANY: 400,
  PLAN_NOT_EMPTY: 409,
  NOTHING_TO_COPY: 404,
  BASE_CURRENCY_ONLY_TWO_DECIMALS: 400,
};

// ── settings ───────────────────────────────────────────────────────────────

type UserDoc = { preferences?: { timezone?: string; envelopes?: { enabled?: boolean } } } | null;

async function readUser(userId: string) {
  await connectDB();
  const doc = await User.findById(userId).select("preferences.timezone preferences.envelopes").lean<UserDoc>();
  const tz = doc?.preferences?.timezone;
  return {
    enabled: doc?.preferences?.envelopes?.enabled === true,
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
  };
}

export async function getEnvelopeSettings(userId: string): Promise<{ enabled: boolean }> {
  return { enabled: (await readUser(userId)).enabled };
}

export async function setEnvelopesEnabled(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  await connectDB();
  await User.updateOne({ _id: userId }, { $set: { "preferences.envelopes.enabled": enabled } });
  return { enabled };
}

// ── read ───────────────────────────────────────────────────────────────────

export interface EnvelopeRow {
  category: string;
  assigned: number;
  spent: number;
  /** assigned - spent; negative when overspent. */
  left: number;
  overspent: boolean;
}

export interface EnvelopeMoveView {
  from: string;
  to: string;
  amount: number;
  at: string;
}

export interface EnvelopeView {
  enabled: boolean;
  month: string;
  currency: string;
  exponent: number;
  income: number;
  /** Sum of every envelope's assigned amount. */
  assigned: number;
  /** income - assigned; negative when more is assigned than expected income. */
  unassigned: number;
  overAssigned: boolean;
  envelopes: EnvelopeRow[];
  /** Budget categories of this month that are not an envelope yet. */
  suggested: { category: string; limitAmount: number }[];
  /** Newest first, up to 20. */
  moves: EnvelopeMoveView[];
  previousMonth: string;
  /** The previous month has a plan that could be copied into an empty month. */
  hasPrevious: boolean;
}

export function previousMonthOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

type PlanDoc = {
  income?: number;
  envelopes?: { category: string; assigned: number }[];
  moves?: { from: string; to: string; amount: number; at: Date }[];
} | null;

async function currentMonthKey(timeZone: string): Promise<string> {
  const { year, month } = localDate(new Date(), timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The plan for a month (default: this month in the user's time zone) with what each envelope spent. */
export async function getEnvelopePlan(userId: string, month?: string): Promise<EnvelopeView> {
  const settings = await readUser(userId);
  const key = month ?? (await currentMonthKey(settings.timeZone));
  const { base } = await getBaseState(userId);
  const empty: EnvelopeView = {
    enabled: settings.enabled,
    month: key,
    currency: base,
    exponent: minorExponent(base),
    income: 0,
    assigned: 0,
    unassigned: 0,
    overAssigned: false,
    envelopes: [],
    suggested: [],
    moves: [],
    previousMonth: previousMonthOf(key),
    hasPrevious: false,
  };
  if (!settings.enabled) return empty;

  const year = Number(key.slice(0, 4));
  const monthNo = Number(key.slice(5, 7));
  const plan = await EnvelopePlan.findOne({ user: userId, month: key }).lean<PlanDoc>();
  const envelopes = plan?.envelopes ?? [];
  const [spent, budgets, previous] = await Promise.all([
    spentByCategory(userId, envelopes.map((e) => e.category), year, monthNo),
    Budget.find({ user: userId, year, month: monthNo, isDeleted: { $ne: true } }, { category: 1, limitAmount: 1 })
      .sort({ category: 1 })
      .limit(MAX_ENVELOPES * 2)
      .lean<{ category: string; limitAmount: number }[]>(),
    EnvelopePlan.exists({ user: userId, month: empty.previousMonth, "envelopes.0": { $exists: true } }),
  ]);

  const rows: EnvelopeRow[] = envelopes.map((e) => {
    const s = spent.get(e.category) ?? 0;
    return { category: e.category, assigned: e.assigned, spent: s, left: e.assigned - s, overspent: s > e.assigned };
  });
  const assigned = rows.reduce((n, r) => n + r.assigned, 0);
  const income = plan?.income ?? 0;
  const have = new Set(envelopes.map((e) => e.category));
  return {
    ...empty,
    income,
    assigned,
    unassigned: income - assigned,
    overAssigned: assigned > income,
    envelopes: rows,
    suggested: budgets.filter((b) => !have.has(b.category)).map((b) => ({ category: b.category, limitAmount: b.limitAmount })),
    moves: [...(plan?.moves ?? [])]
      .slice(-MOVES_SHOWN)
      .reverse()
      .map((mv) => ({ from: mv.from, to: mv.to, amount: mv.amount, at: new Date(mv.at).toISOString() })),
    hasPrevious: Boolean(previous),
  };
}

// ── writes ─────────────────────────────────────────────────────────────────

async function writableBase(userId: string) {
  const settings = await readUser(userId);
  if (!settings.enabled) throw new EnvelopeError("ENVELOPES_DISABLED", "Turn on envelope mode first");
  const state = await getBaseState(userId);
  if (!isSupportedAsBase(state.base)) throw new EnvelopeError("BASE_CURRENCY_ONLY_TWO_DECIMALS", BASE_CURRENCY_ONLY_TWO_DECIMALS);
  return state;
}

function isDuplicateKey(err: unknown) {
  return (err as { code?: number } | null)?.code === 11000;
}

/** Makes sure the month's document exists, without touching one that does. */
async function ensurePlan(userId: string, month: string) {
  try {
    await EnvelopePlan.updateOne(
      { user: userId, month },
      { $setOnInsert: { income: 0, envelopes: [], moves: [], createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    // Two requests creating the same month at once: the other one won, which is fine.
    if (!isDuplicateKey(err)) throw err;
  }
}

/** Set income and the amount of each listed envelope (new ones are added), and drop the envelopes in `remove`. */
export async function assignEnvelopes(userId: string, input: EnvelopeAssignInput): Promise<EnvelopeView> {
  const state = await writableBase(userId);
  const assign = (input.assign ?? []).map((a) => ({ category: a.category, assigned: a.assigned }));
  const remove = [...new Set(input.remove ?? [])];
  const assignKeys = assign.map((a) => a.category);

  // The cap, checked here for a clean error before the base is locked, and again inside the update.
  const current = await EnvelopePlan.findOne({ user: userId, month: input.month }, { "envelopes.category": 1 }).lean<PlanDoc>();
  const after = new Set((current?.envelopes ?? []).map((e) => e.category).filter((c) => !remove.includes(c)));
  for (const k of assignKeys) after.add(k);
  if (after.size > MAX_ENVELOPES) throw new EnvelopeError("TOO_MANY", `At most ${MAX_ENVELOPES} envelopes in a month`);

  if ((input.income ?? 0) > 0 || assign.some((a) => a.assigned > 0)) await lockBaseCurrency(userId, state);
  await ensurePlan(userId, input.month);

  const existingKeys = { $map: { input: { $ifNull: ["$envelopes", []] }, as: "x", in: "$$x.category" } };
  const resultKeys = { $setUnion: [{ $setDifference: [existingKeys, { $literal: remove }] }, { $literal: assignKeys }] };
  // Existing envelopes keep their place (assigned replaced when listed), new ones go at the end.
  const merged = {
    $concatArrays: [
      {
        $map: {
          input: { $filter: { input: { $ifNull: ["$envelopes", []] }, as: "e", cond: { $not: { $in: ["$$e.category", { $literal: remove }] } } } },
          as: "e",
          in: {
            $let: {
              vars: {
                hit: { $arrayElemAt: [{ $filter: { input: { $literal: assign }, as: "a", cond: { $eq: ["$$a.category", "$$e.category"] } } }, 0] },
              },
              in: {
                $cond: [
                  { $eq: [{ $type: "$$hit" }, "missing"] },
                  "$$e",
                  { category: "$$e.category", assigned: "$$hit.assigned" },
                ],
              },
            },
          },
        },
      },
      {
        $filter: {
          input: { $literal: assign },
          as: "a",
          cond: { $not: { $in: ["$$a.category", existingKeys] } },
        },
      },
    ],
  };
  const set: Record<string, unknown> = { envelopes: merged, updatedAt: "$$NOW" };
  if (input.income !== undefined) set.income = { $literal: input.income };

  const updated = await EnvelopePlan.findOneAndUpdate(
    { user: userId, month: input.month, $expr: { $lte: [{ $size: resultKeys }, MAX_ENVELOPES] } },
    [{ $set: set }],
    { returnDocument: "after", updatePipeline: true }
  ).lean<PlanDoc>();
  if (!updated) throw new EnvelopeError("TOO_MANY", `At most ${MAX_ENVELOPES} envelopes in a month`);
  return getEnvelopePlan(userId, input.month);
}

/** Take `amount` from one envelope and give it to another, in one atomic update. */
export async function moveBetweenEnvelopes(userId: string, input: EnvelopeMoveInput): Promise<EnvelopeView> {
  await writableBase(userId);
  const { month, from, to, amount } = input;
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));

  // What the source has already spent: unless overdraw is allowed, assigned must stay above it.
  const floor = input.allowOverdraw ? 0 : ((await spentByCategory(userId, [from], year, monthNo)).get(from) ?? 0);
  const now = new Date();
  const res = await EnvelopePlan.updateOne(
    {
      user: userId,
      month,
      $and: [
        { envelopes: { $elemMatch: { category: from, assigned: { $gte: amount + floor } } } },
        { envelopes: { $elemMatch: { category: to, assigned: { $lte: MAX_MINOR_AMOUNT - amount } } } },
      ],
    },
    {
      $inc: { "envelopes.$[f].assigned": -amount, "envelopes.$[t].assigned": amount },
      $set: { updatedAt: now },
      $push: { moves: { $each: [{ from, to, amount, at: now }], $slice: -MAX_MOVES } },
    },
    { arrayFilters: [{ "f.category": from }, { "t.category": to }] }
  );
  if (res.matchedCount === 0) {
    const plan = await EnvelopePlan.findOne({ user: userId, month }, { envelopes: 1 }).lean<PlanDoc>();
    const names = new Set((plan?.envelopes ?? []).map((e) => e.category));
    if (!names.has(from) || !names.has(to)) throw new EnvelopeError("ENVELOPE_NOT_FOUND", "Both envelopes must be in this month's plan");
    const src = plan?.envelopes?.find((e) => e.category === from);
    throw new EnvelopeError(
      "INSUFFICIENT",
      input.allowOverdraw || floor === 0
        ? `${from} has ${src?.assigned ?? 0} assigned, less than the amount to move`
        : `${from} has already spent ${floor} of its ${src?.assigned ?? 0}; move less, or allow overspending`
    );
  }
  return getEnvelopePlan(userId, month);
}

/** Copy the income and envelopes of another month (default: the month before) into a month with no envelopes yet. */
export async function copyEnvelopePlan(userId: string, input: EnvelopeCopyInput): Promise<EnvelopeView> {
  const state = await writableBase(userId);
  const source = input.from ?? previousMonthOf(input.month);
  const src = await EnvelopePlan.findOne({ user: userId, month: source }).lean<PlanDoc>();
  if (!src?.envelopes?.length) throw new EnvelopeError("NOTHING_TO_COPY", `There is no plan for ${source} to copy`);

  await lockBaseCurrency(userId, state);
  await ensurePlan(userId, input.month);
  const res = await EnvelopePlan.updateOne(
    { user: userId, month: input.month, "envelopes.0": { $exists: false } },
    { $set: { income: src.income ?? 0, envelopes: src.envelopes.map((e) => ({ category: e.category, assigned: e.assigned })), updatedAt: new Date() } }
  );
  if (res.matchedCount === 0) throw new EnvelopeError("PLAN_NOT_EMPTY", `${input.month} already has envelopes`);
  return getEnvelopePlan(userId, input.month);
}
