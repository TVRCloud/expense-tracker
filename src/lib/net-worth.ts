import { z } from "zod";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import Account from "@/models/Account";
import Loan from "@/models/Loan";
import User from "@/models/User";
import ManualAsset from "@/models/ManualAsset";
import NetWorthSnapshot from "@/models/NetWorthSnapshot";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";
import { lockBaseCurrency } from "@/lib/base-currency";

// Net worth: what the user owns minus what they owe, now and over time.
// Shared by the browser routes (/api/net-worth) and the integration routes
// (/api/integrations/net-worth) so both report the same numbers. Amounts are
// cents. All accounts are counted as one currency (the app is INR-only today).
//
// Owned:  accounts with a positive balance (bank, savings, cash, wallet,
//         investment), a card with a credit balance, money lent that is not
//         yet paid back, and the manual assets the user keeps.
// Owed:   a credit card balance below zero, any other account below zero (an
//         overdraft), and money borrowed that is not yet paid back.
// Settled loans and archived or deleted accounts count for nothing.

export class NetWorthServiceError extends Error {
  constructor(public code: "ASSET_NOT_FOUND", message: string) {
    super(message);
  }
}

export const MANUAL_ASSET_KINDS = ["property", "vehicle", "gold", "investment", "other"] as const;

const MAX_CENTS = 1_000_000_000_000_00; // 1e14 cents, far past any real figure

export const manualAssetCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(MANUAL_ASSET_KINDS).default("other"),
  value: z.number().int().min(0).max(MAX_CENTS),
  note: z.string().trim().max(200).optional(),
});

export const manualAssetUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(MANUAL_ASSET_KINDS),
    value: z.number().int().min(0).max(MAX_CENTS),
    note: z.string().trim().max(200).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const NET_WORTH_RANGES = ["30d", "90d", "1y", "all"] as const;
export type NetWorthRange = (typeof NET_WORTH_RANGES)[number];

const RANGE_DAYS: Record<Exclude<NetWorthRange, "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };

export type BreakdownRow = { key: string; label: string; amount: number; count: number };

export type NetWorthNow = {
  assets: number;
  liabilities: number;
  netWorth: number;
  breakdown: { assets: BreakdownRow[]; liabilities: BreakdownRow[] };
};

export type NetWorthPoint = { date: string; assets: number; liabilities: number; netWorth: number };

export type NetWorthReport = NetWorthNow & {
  range: NetWorthRange;
  history: NetWorthPoint[];
  change: { amount: number; percent: number | null; since: string | null };
};

export type ManualAssetItem = {
  id: string;
  name: string;
  kind: (typeof MANUAL_ASSET_KINDS)[number];
  value: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

const ASSET_LABELS: Record<string, string> = {
  bank: "Bank accounts",
  savings: "Savings",
  cash: "Cash",
  wallet: "Wallets",
  investment: "Investments",
  cardCredit: "Card credit balances",
  loansGiven: "Money lent",
  manual: "Other assets",
};
const LIABILITY_LABELS: Record<string, string> = {
  cards: "Credit cards",
  overdrafts: "Overdrawn accounts",
  loansReceived: "Money borrowed",
};

function addTo(map: Map<string, BreakdownRow>, key: string, labels: Record<string, string>, amount: number) {
  if (amount <= 0) return;
  const row = map.get(key) ?? { key, label: labels[key] ?? key, amount: 0, count: 0 };
  row.amount += amount;
  row.count += 1;
  map.set(key, row);
}

function ordered(map: Map<string, BreakdownRow>, labels: Record<string, string>): BreakdownRow[] {
  const order = Object.keys(labels);
  return [...map.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** What the user owns and owes right now, with the rows that add up to it. */
export async function computeNetWorth(userId: string): Promise<NetWorthNow> {
  await connectDB();
  const [accounts, loans, manual] = await Promise.all([
    Account.find({ user: userId, isArchived: { $ne: true }, deletedAt: null })
      .select("type balance")
      .lean<Array<{ type: string; balance: number }>>(),
    Loan.find({ user: userId, isDeleted: { $ne: true }, isSettled: { $ne: true } })
      .select("direction remainingAmount")
      .lean<Array<{ direction: "given" | "received"; remainingAmount: number }>>(),
    ManualAsset.find({ user: userId, isArchived: false }).select("value").lean<Array<{ value: number }>>(),
  ]);

  const assets = new Map<string, BreakdownRow>();
  const liabilities = new Map<string, BreakdownRow>();

  for (const a of accounts) {
    const balance = a.balance ?? 0;
    if (a.type === "credit_card") {
      if (balance < 0) addTo(liabilities, "cards", LIABILITY_LABELS, -balance);
      else addTo(assets, "cardCredit", ASSET_LABELS, balance);
    } else if (balance < 0) {
      addTo(liabilities, "overdrafts", LIABILITY_LABELS, -balance);
    } else {
      addTo(assets, a.type in ASSET_LABELS ? a.type : "bank", ASSET_LABELS, balance);
    }
  }
  for (const l of loans) {
    const remaining = l.remainingAmount ?? 0;
    if (l.direction === "given") addTo(assets, "loansGiven", ASSET_LABELS, remaining);
    else addTo(liabilities, "loansReceived", LIABILITY_LABELS, remaining);
  }
  for (const m of manual) addTo(assets, "manual", ASSET_LABELS, m.value ?? 0);

  const assetRows = ordered(assets, ASSET_LABELS);
  const liabilityRows = ordered(liabilities, LIABILITY_LABELS);
  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  return {
    assets: totalAssets,
    liabilities: totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    breakdown: { assets: assetRows, liabilities: liabilityRows },
  };
}

/** "YYYY-MM-DD" on the wall clock of `timeZone` (the default zone when it is not valid). */
export function localDayKey(now: Date, timeZone: string | undefined | null): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function userTimeZone(userId: string) {
  const user = await User.findById(userId).select("preferences.timezone").lean<{ preferences?: { timezone?: string } } | null>();
  return user?.preferences?.timezone;
}

/**
 * Store today's point (in the user's time zone). Called when net worth is read
 * and by the snapshot cron; the day's last write wins, so the stored point is
 * the day's closing value once the cron has run in the evening.
 */
export async function recordSnapshot(userId: string, now = new Date(), current?: NetWorthNow): Promise<NetWorthPoint> {
  await connectDB();
  const nw = current ?? (await computeNetWorth(userId));
  const day = localDayKey(now, await userTimeZone(userId));
  const write = () =>
    NetWorthSnapshot.updateOne(
      { user: userId, day },
      { $set: { assets: nw.assets, liabilities: nw.liabilities, netWorth: nw.netWorth } },
      { upsert: true }
    );
  try {
    await write();
  } catch (err) {
    // Two writers (a read, the cron) upserting the same user and day can both try to insert: the loser of the
    // race gets a duplicate-key error. The row exists by now, so one more attempt updates it.
    if ((err as { code?: number }).code !== 11000) throw err;
    await write();
  }
  return { date: day, assets: nw.assets, liabilities: nw.liabilities, netWorth: nw.netWorth };
}

function shiftDay(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Net worth now, the trend for `range`, and how much it moved over that range. */
export async function getNetWorth(userId: string, range: NetWorthRange = "90d", now = new Date()): Promise<NetWorthReport> {
  const current = await computeNetWorth(userId);
  const today = await recordSnapshot(userId, now, current);

  const filter: Record<string, unknown> = { user: userId };
  if (range !== "all") filter.day = { $gte: shiftDay(today.date, -RANGE_DAYS[range]) };
  const rows = await NetWorthSnapshot.find(filter)
    .sort({ day: 1 })
    .select("day assets liabilities netWorth")
    .lean<Array<{ day: string; assets: number; liabilities: number; netWorth: number }>>();

  const history: NetWorthPoint[] = rows.map((r) => ({
    date: r.day,
    assets: r.assets,
    liabilities: r.liabilities,
    netWorth: r.netWorth,
  }));

  const first = history[0];
  const amount = first ? current.netWorth - first.netWorth : 0;
  const percent = first && first.netWorth !== 0 ? Math.round((amount / Math.abs(first.netWorth)) * 1000) / 10 : null;
  return {
    ...current,
    range,
    history,
    change: { amount, percent, since: first && first.date !== today.date ? first.date : null },
  };
}

// A pass that has been going for this long is treated as hung, so one stuck database call cannot block every
// later run until the process restarts.
const RUN_STALE_AFTER_MS = 10 * 60 * 1000;
let snapshotsStartedAt: number | null = null;

/**
 * Cron: record today's point for every active user that has something to count. A user who had a point
 * before but now has nothing still gets today's zero, so the trend does not keep a stale value. Only one
 * run at a time per process (the server.ts timer and the cron route can overlap); users are read through a
 * cursor and handled one by one.
 */
export async function recordSnapshotsForAllUsers(now = new Date()): Promise<{ checked: number; recorded: number; skipped?: true }> {
  const startedAt = Date.now();
  if (snapshotsStartedAt !== null && startedAt - snapshotsStartedAt < RUN_STALE_AFTER_MS) {
    logger.warn({ runningForMs: startedAt - snapshotsStartedAt }, "Net worth snapshots skipped: a pass is still running");
    return { checked: 0, recorded: 0, skipped: true };
  }
  if (snapshotsStartedAt !== null) logger.warn({ runningForMs: startedAt - snapshotsStartedAt }, "Net worth snapshots: an earlier pass looks hung, starting a new one");
  snapshotsStartedAt = startedAt;
  try {
    await connectDB();
    let checked = 0;
    let recorded = 0;
    const cursor = User.find({ isActive: { $ne: false } }).select("_id").lean<{ _id: unknown }>().cursor();
    for await (const u of cursor) {
      checked += 1;
      try {
        const id = String(u._id);
        const nw = await computeNetWorth(id);
        if (nw.assets === 0 && nw.liabilities === 0 && !(await NetWorthSnapshot.exists({ user: id }))) continue;
        await recordSnapshot(id, now, nw);
        recorded += 1;
      } catch (err) {
        logger.error({ err, userId: String(u._id) }, "Net worth snapshot failed");
      }
    }
    return { checked, recorded };
  } finally {
    // Only release our own claim: a hung pass that finishes late must not clear a newer pass's.
    if (snapshotsStartedAt === startedAt) snapshotsStartedAt = null;
  }
}

// ---------------------------------------------------------------------------
// Manual assets

type AssetDoc = {
  _id: { toString(): string };
  name: string;
  kind: ManualAssetItem["kind"];
  value: number;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

function toAssetItem(d: AssetDoc): ManualAssetItem {
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind,
    value: d.value,
    note: d.note ?? null,
    createdAt: (d.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (d.updatedAt ?? new Date(0)).toISOString(),
  };
}

export async function listManualAssets(userId: string): Promise<ManualAssetItem[]> {
  await connectDB();
  const docs = await ManualAsset.find({ user: userId, isArchived: false }).sort({ createdAt: -1 }).lean<AssetDoc[]>();
  return docs.map(toAssetItem);
}

export async function createManualAsset(userId: string, input: z.infer<typeof manualAssetCreateSchema>): Promise<ManualAssetItem> {
  await connectDB();
  await lockBaseCurrency(userId);
  const doc = await ManualAsset.create({ user: userId, ...input });
  return toAssetItem(doc.toObject() as AssetDoc);
}

export async function updateManualAsset(userId: string, id: string, input: z.infer<typeof manualAssetUpdateSchema>): Promise<ManualAssetItem> {
  await connectDB();
  const { note, ...rest } = input;
  const update: Record<string, unknown> = { $set: { ...rest } };
  if (note === null) update.$unset = { note: "" };
  else if (note !== undefined) (update.$set as Record<string, unknown>).note = note;
  const doc = await ManualAsset.findOneAndUpdate({ _id: id, user: userId, isArchived: false }, update, { returnDocument: "after" }).lean<AssetDoc | null>();
  if (!doc) throw new NetWorthServiceError("ASSET_NOT_FOUND", "Asset not found");
  return toAssetItem(doc);
}

/** Archive (not delete) so realtime sees the change. */
export async function archiveManualAsset(userId: string, id: string): Promise<{ id: string; deleted: true }> {
  await connectDB();
  const doc = await ManualAsset.findOneAndUpdate({ _id: id, user: userId, isArchived: false }, { $set: { isArchived: true } }).lean<AssetDoc | null>();
  if (!doc) throw new NetWorthServiceError("ASSET_NOT_FOUND", "Asset not found");
  return { id: String(doc._id), deleted: true };
}
