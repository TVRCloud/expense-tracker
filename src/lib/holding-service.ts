import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Holding, { HOLDING_KINDS, type HoldingKind } from "@/models/Holding";
import { BASE_CURRENCY_ONLY_TWO_DECIMALS, isSupportedAsBase, MAX_MINOR_AMOUNT } from "@/lib/currency";
import { getBaseState, lockBaseCurrency } from "@/lib/base-currency";
import { userTimeZone } from "@/lib/net-worth";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/lib/spend-limit-time";
import {
  dayNumber,
  fdFitsAmount,
  fdValue,
  formatMicro,
  gainPercent,
  isDayKey,
  MAX_UNITS_MICRO,
  parseDecimal,
  sipDueDates,
  UNIT_DECIMALS,
  valueFromPrice,
} from "@/lib/holding-math";

// Holdings: stocks, funds, gold, fixed deposits and PPF the person keeps track
// of by hand. Shared by the browser routes (/api/holdings) and the integration
// routes (/api/integrations/holdings). They never post a transaction; they only
// feed net worth (src/lib/net-worth.ts). Amounts are integer minor units of the
// base currency.

/**
 * Most holdings one person can keep. Every value is at most MAX_MINOR_AMOUNT (a fixed deposit's value is capped
 * there, see holding-math fdValue), so 500 of them add up to 5e15, inside the 9e15 a double holds exactly.
 */
export const MAX_HOLDINGS = 500;
const MAX_HISTORY = 100;
const SIP_LOOKAHEAD_DAYS = 60;
const MAX_SIPS_LISTED = 50;
export const MAX_FD_TERM_DAYS = 365 * 50;

export type HoldingErrorCode =
  | "HOLDING_NOT_FOUND"
  | "HOLDING_LIMIT"
  | "UNSUPPORTED_BASE_CURRENCY"
  | "UNITS_REQUIRED"
  | "VALUE_NOT_SETTABLE"
  | "NOT_ALLOWED";

export class HoldingError extends Error {
  code: HoldingErrorCode;
  constructor(code: HoldingErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "HoldingError";
  }
}

const notFound = () => new HoldingError("HOLDING_NOT_FOUND", "Holding not found");

/** HTTP status for an error code, shared by every route. */
export function holdingStatus(code: HoldingErrorCode): number {
  if (code === "HOLDING_NOT_FOUND") return 404;
  if (code === "HOLDING_LIMIT") return 409;
  return 400;
}

/** Integration error code (src/lib/integrations/response.ts) for a holding error code. */
export function holdingIntegrationCode(code: HoldingErrorCode): "NOT_FOUND" | "CONFLICT" | "BASE_CURRENCY_ONLY_TWO_DECIMALS" | "VALIDATION_ERROR" {
  if (code === "HOLDING_NOT_FOUND") return "NOT_FOUND";
  if (code === "HOLDING_LIMIT") return "CONFLICT";
  if (code === "UNSUPPORTED_BASE_CURRENCY") return "BASE_CURRENCY_ONLY_TWO_DECIMALS";
  return "VALIDATION_ERROR";
}

// ---------------------------------------------------------------------------
// Input

const dayKey = z.string().refine(isDayKey, "Enter a valid date as YYYY-MM-DD");
const minor = z.number().int().min(0).max(MAX_MINOR_AMOUNT);
const units = z
  .string()
  .trim()
  .refine((v) => {
    const parsed = parseDecimal(v, UNIT_DECIMALS);
    return parsed !== null && parsed <= BigInt(MAX_UNITS_MICRO);
  }, `Enter units as a number with at most ${UNIT_DECIMALS} decimals, up to 1,000,000,000`);

const sipSchema = z.object({
  amount: z.number().int().min(1).max(MAX_MINOR_AMOUNT),
  dayOfMonth: z.number().int().min(1).max(31),
  startDay: dayKey,
  active: z.boolean().default(true),
});

const fdSchema = z
  .object({
    principal: z.number().int().min(1).max(MAX_MINOR_AMOUNT),
    rateBps: z.number().int().min(0).max(10_000),
    startDay: dayKey,
    maturityDay: dayKey,
  })
  // The date fields report their own errors; these two only compare dates that are valid.
  .refine((v) => !isDayKey(v.startDay) || !isDayKey(v.maturityDay) || dayNumber(v.maturityDay) > dayNumber(v.startDay), {
    message: "Maturity must be after the start",
    path: ["maturityDay"],
  })
  .refine((v) => !isDayKey(v.startDay) || !isDayKey(v.maturityDay) || dayNumber(v.maturityDay) - dayNumber(v.startDay) <= MAX_FD_TERM_DAYS, {
    message: "A deposit can run for at most 50 years",
    path: ["maturityDay"],
  })
  // The value at maturity must fit in an amount, so a deposit's value is never cut short (see fdValue).
  .refine((v) => !isDayKey(v.startDay) || !isDayKey(v.maturityDay) || fdFitsAmount(v), {
    message: "The deposit would be worth more than can be kept at maturity",
    path: ["principal"],
  });

export const holdingCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name this holding").max(60),
    kind: z.enum(HOLDING_KINDS),
    note: z.string().trim().max(200).optional(),
    units: units.optional(),
    investedAmount: minor.optional(),
    currentValue: minor.optional(),
    sip: sipSchema.optional(),
    fd: fdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "fixed_deposit") {
      if (!v.fd) issue("fd", "A fixed deposit needs its principal, rate and dates");
      for (const f of ["units", "investedAmount", "currentValue", "sip"] as const) {
        if (v[f] !== undefined) issue(f, "Not used for a fixed deposit: its value follows its terms");
      }
    } else {
      if (v.fd) issue("fd", "Only a fixed deposit has deposit terms");
      if (v.investedAmount === undefined) issue("investedAmount", "Enter what you have put in");
    }
  });

export const holdingUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    note: z.string().trim().max(200).nullable(),
    units: units.nullable(),
    investedAmount: minor,
    sip: sipSchema.nullable(),
    fd: fdSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

/** A new manual value: the total in minor units, or a price per unit (a decimal string) times the units held. */
export const holdingValueSchema = z
  .object({
    value: minor.optional(),
    price: z.string().trim().max(24).optional(),
  })
  .refine((v) => (v.value === undefined) !== (v.price === undefined), { message: "Send either value or price" });

export type HoldingCreateInput = z.infer<typeof holdingCreateSchema>;
export type HoldingUpdateInput = z.infer<typeof holdingUpdateSchema>;
export type HoldingValueInput = z.infer<typeof holdingValueSchema>;

// ---------------------------------------------------------------------------
// Output

type SipDoc = { amount: number; dayOfMonth: number; startDay: string; active: boolean };
type FdDoc = { principal: number; rateBps: number; startDay: string; maturityDay: string };

export type HoldingDoc = {
  _id: { toString(): string };
  name: string;
  kind: HoldingKind;
  note?: string | null;
  unitsMicro?: number | null;
  investedAmount: number;
  currentValue: number;
  valueUpdatedAt?: Date | null;
  history?: Array<{ value: number; at: Date }>;
  sip?: SipDoc | null;
  fd?: FdDoc | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type HoldingView = {
  id: string;
  name: string;
  kind: HoldingKind;
  note: string | null;
  /** Units held as a decimal string ("12.5"), null when not tracked. */
  units: string | null;
  invested: number;
  /** Today's value: the manual value, or for a fixed deposit principal plus the interest earned so far. */
  value: number;
  gain: number;
  /** One decimal; null when nothing was invested. */
  gainPercent: number | null;
  valueUpdatedAt: string | null;
  sip: (SipDoc & { nextDue: string | null }) | null;
  fd:
    | (FdDoc & { accrued: number; maturityValue: number; termDays: number; daysToMaturity: number; matured: boolean })
    | null;
  createdAt: string;
  updatedAt: string;
};

export function describeHolding(d: HoldingDoc, todayKey: string): HoldingView {
  const fd = d.fd ? fdValue(d.fd, todayKey) : null;
  const value = fd ? fd.value : d.currentValue;
  const invested = d.fd ? d.fd.principal : d.investedAmount;
  const sip = d.sip
    ? { amount: d.sip.amount, dayOfMonth: d.sip.dayOfMonth, startDay: d.sip.startDay, active: d.sip.active, nextDue: sipDueDates(d.sip, todayKey, SIP_LOOKAHEAD_DAYS, 1)[0] ?? null }
    : null;
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind,
    note: d.note ?? null,
    units: d.unitsMicro === undefined || d.unitsMicro === null ? null : formatMicro(d.unitsMicro),
    invested,
    value,
    gain: value - invested,
    gainPercent: gainPercent(invested, value),
    valueUpdatedAt: d.valueUpdatedAt ? new Date(d.valueUpdatedAt).toISOString() : null,
    sip,
    fd:
      d.fd && fd
        ? { ...d.fd, accrued: fd.accrued, maturityValue: fd.maturityValue, termDays: fd.termDays, daysToMaturity: fd.daysToMaturity, matured: fd.matured }
        : null,
    createdAt: (d.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (d.updatedAt ?? new Date(0)).toISOString(),
  };
}

export type KindBreakdown = { kind: HoldingKind; count: number; invested: number; value: number; gain: number };
export type HoldingTotals = { count: number; invested: number; value: number; gain: number; gainPercent: number | null };
export type UpcomingSip = { holdingId: string; name: string; amount: number; date: string };

export function totalHoldings(views: HoldingView[]): { totals: HoldingTotals; byKind: KindBreakdown[] } {
  const byKind = new Map<HoldingKind, KindBreakdown>();
  let invested = 0;
  let value = 0;
  for (const v of views) {
    invested += v.invested;
    value += v.value;
    const row = byKind.get(v.kind) ?? { kind: v.kind, count: 0, invested: 0, value: 0, gain: 0 };
    row.count += 1;
    row.invested += v.invested;
    row.value += v.value;
    row.gain = row.value - row.invested;
    byKind.set(v.kind, row);
  }
  const rows = [...byKind.values()].sort((a, b) => HOLDING_KINDS.indexOf(a.kind) - HOLDING_KINDS.indexOf(b.kind));
  return {
    totals: { count: views.length, invested, value, gain: value - invested, gainPercent: gainPercent(invested, value) },
    byKind: rows,
  };
}

/** Next due dates of every active SIP in the next 60 days, soonest first (at most 50). */
export function upcomingSips(docs: HoldingDoc[], todayKey: string): UpcomingSip[] {
  const out: UpcomingSip[] = [];
  for (const d of docs) {
    if (!d.sip) continue;
    for (const date of sipDueDates(d.sip, todayKey, SIP_LOOKAHEAD_DAYS, 3)) {
      out.push({ holdingId: String(d._id), name: d.name, amount: d.sip.amount, date });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1)).slice(0, MAX_SIPS_LISTED);
}

async function today(userId: string, now: Date): Promise<string> {
  return localDateKey(now, (await userTimeZone(userId)) ?? DEFAULT_TIME_ZONE);
}

const live = (userId: string) => ({ user: userId, isArchived: { $ne: true } });

// ---------------------------------------------------------------------------
// Reads

export async function listHoldings(userId: string, now: Date = new Date()) {
  await connectDB();
  const todayKey = await today(userId, now);
  const docs = await Holding.find(live(userId)).select("-history").sort({ createdAt: -1, _id: -1 }).limit(MAX_HOLDINGS).lean<HoldingDoc[]>();
  const holdings = docs.map((d) => describeHolding(d, todayKey));
  return { holdings, ...totalHoldings(holdings), upcomingSips: upcomingSips(docs, todayKey) };
}

export async function getHolding(userId: string, id: string, now: Date = new Date()) {
  await connectDB();
  const todayKey = await today(userId, now);
  const doc = await Holding.findOne({ _id: id, ...live(userId) }).lean<HoldingDoc>();
  if (!doc) throw notFound();
  return {
    ...describeHolding(doc, todayKey),
    // Newest first, at most 100.
    history: [...(doc.history ?? [])].reverse().map((h) => ({ value: h.value, at: new Date(h.at).toISOString() })),
  };
}

export async function listSips(userId: string, now: Date = new Date()) {
  await connectDB();
  const todayKey = await today(userId, now);
  const docs = await Holding.find({ ...live(userId), "sip.active": true }).select("name sip").limit(MAX_HOLDINGS).lean<HoldingDoc[]>();
  return { sips: upcomingSips(docs, todayKey) };
}

// ---------------------------------------------------------------------------
// Writes

function microOf(u: string): number {
  return Number(parseDecimal(u, UNIT_DECIMALS) as bigint);
}

export async function createHolding(userId: string, input: HoldingCreateInput, now: Date = new Date()): Promise<HoldingView> {
  await connectDB();
  const state = await getBaseState(userId);
  if (!isSupportedAsBase(state.base)) throw new HoldingError("UNSUPPORTED_BASE_CURRENCY", BASE_CURRENCY_ONLY_TWO_DECIMALS);
  if ((await Holding.countDocuments(live(userId))) >= MAX_HOLDINGS) {
    throw new HoldingError("HOLDING_LIMIT", `You can keep at most ${MAX_HOLDINGS} holdings`);
  }
  const todayKey = await today(userId, now);

  const isFd = input.kind === "fixed_deposit" && input.fd;
  const invested = isFd ? input.fd!.principal : (input.investedAmount ?? 0);
  const current = isFd ? fdValue(input.fd!, todayKey).value : (input.currentValue ?? invested);
  // The base is locked before the insert (every writer of a base-unit amount must), so a create that then loses the
  // race for the last place below has locked the base without leaving a row: the same as a write rejected after the lock.
  await lockBaseCurrency(userId, state);
  const doc = await Holding.create({
    user: userId,
    name: input.name,
    kind: input.kind,
    note: input.note,
    unitsMicro: input.units === undefined ? undefined : microOf(input.units),
    investedAmount: invested,
    currentValue: current,
    valueUpdatedAt: input.kind === "fixed_deposit" ? undefined : now,
    history: input.kind === "fixed_deposit" ? [] : [{ value: current, at: now }],
    sip: input.sip,
    fd: input.fd,
  });
  // Two creates at the limit can both pass the count above; the later one takes itself back out.
  if ((await Holding.countDocuments(live(userId))) > MAX_HOLDINGS) {
    await Holding.deleteOne({ _id: doc._id, user: userId });
    throw new HoldingError("HOLDING_LIMIT", `You can keep at most ${MAX_HOLDINGS} holdings`);
  }
  return describeHolding(doc.toObject() as HoldingDoc, todayKey);
}

export async function updateHolding(userId: string, id: string, input: HoldingUpdateInput, now: Date = new Date()): Promise<HoldingView> {
  await connectDB();
  const existing = await Holding.findOne({ _id: id, ...live(userId) }).select("kind").lean<{ kind: HoldingKind }>();
  if (!existing) throw notFound();
  const isFd = existing.kind === "fixed_deposit";
  if (isFd && (input.units !== undefined || input.investedAmount !== undefined || input.sip !== undefined)) {
    throw new HoldingError("NOT_ALLOWED", "A fixed deposit's value follows its terms: change the deposit terms instead");
  }
  if (!isFd && input.fd !== undefined) throw new HoldingError("NOT_ALLOWED", "Only a fixed deposit has deposit terms");

  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.note === null) unset.note = "";
  else if (input.note !== undefined) set.note = input.note;
  if (input.units === null) unset.unitsMicro = "";
  else if (input.units !== undefined) set.unitsMicro = microOf(input.units);
  if (input.investedAmount !== undefined) set.investedAmount = input.investedAmount;
  if (input.sip === null) unset.sip = "";
  else if (input.sip !== undefined) set.sip = input.sip;
  if (input.fd !== undefined) {
    set.fd = input.fd;
    set.investedAmount = input.fd.principal;
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  const doc = await Holding.findOneAndUpdate({ _id: id, ...live(userId) }, update, { returnDocument: "after" }).lean<HoldingDoc | null>();
  if (!doc) throw notFound();
  return describeHolding(doc, await today(userId, now));
}

/** Archive (not delete) so realtime sees the change. */
export async function archiveHolding(userId: string, id: string): Promise<{ id: string; deleted: true }> {
  await connectDB();
  const doc = await Holding.findOneAndUpdate({ _id: id, ...live(userId) }, { $set: { isArchived: true, archivedAt: new Date() } }).lean<HoldingDoc | null>();
  if (!doc) throw notFound();
  return { id: String(doc._id), deleted: true };
}

/** Record a new manual value (a total, or a price per unit times the units held) and keep the last 100 in the history. */
export async function recordHoldingValue(userId: string, id: string, input: HoldingValueInput, now: Date = new Date()): Promise<HoldingView> {
  await connectDB();
  const existing = await Holding.findOne({ _id: id, ...live(userId) }).select("kind unitsMicro").lean<{ kind: HoldingKind; unitsMicro?: number | null }>();
  if (!existing) throw notFound();
  if (existing.kind === "fixed_deposit") throw new HoldingError("VALUE_NOT_SETTABLE", "A fixed deposit's value follows its terms");

  let value = input.value;
  if (value === undefined) {
    if (existing.unitsMicro === undefined || existing.unitsMicro === null) {
      throw new HoldingError("UNITS_REQUIRED", "Set how many units you hold before entering a price");
    }
    const priced = valueFromPrice(existing.unitsMicro, input.price ?? "");
    if (priced === null) throw new HoldingError("NOT_ALLOWED", "Enter the price as a number with at most 4 decimals");
    if (priced > MAX_MINOR_AMOUNT) throw new HoldingError("NOT_ALLOWED", "That value is larger than can be kept");
    value = priced;
  }
  const doc = await Holding.findOneAndUpdate(
    { _id: id, ...live(userId) },
    { $set: { currentValue: value, valueUpdatedAt: now }, $push: { history: { $each: [{ value, at: now }], $slice: -MAX_HISTORY } } },
    { returnDocument: "after" }
  ).lean<HoldingDoc | null>();
  if (!doc) throw notFound();
  return describeHolding(doc, await today(userId, now));
}
