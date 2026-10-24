import { createHash } from "crypto";
import { Types, type Model } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Budget from "@/models/Budget";
import Goal from "@/models/Goal";
import Loan from "@/models/Loan";
import ManualAsset from "@/models/ManualAsset";
import Repayment from "@/models/Repayment";
import Rule from "@/models/Rule";
import SinkingFund from "@/models/SinkingFund";
import SpendLimit from "@/models/SpendLimit";
import SubscriptionDecision from "@/models/SubscriptionDecision";
import Transaction from "@/models/Transaction";
import { BackupError, MAX_PLAIN_BYTES } from "@/lib/backup-crypto";

// What goes into a backup, how it is checked on the way back in, and the
// restore itself. The file is untrusted input: every field is whitelisted and
// bounded by the schemas below, ids are never trusted (the caller owns every
// restored row), and a restore never deletes or overwrites anything.
//
// Left out on purpose: API keys, sessions, the password, push subscriptions,
// raw captured messages, notifications, the hash-chained ledger, statements
// and net worth history (derived or secret). The user's preferences stay on
// the account they belong to.

export const BACKUP_PAYLOAD_VERSION = 1;

type AnyModel = Model<Record<string, unknown>>;

export const CAPS = {
  accounts: 1000,
  transactions: 50_000,
  budgets: 20_000,
  goals: 2000,
  loans: 5000,
  repayments: 50_000,
  rules: 2000,
  sinkingFunds: 1000,
  subscriptionDecisions: 5000,
  manualAssets: 1000,
} as const;

const CHUNK = 500;
const MAX_MONEY = 1e14;

const oid = z.string().regex(/^[0-9a-f]{24}$/i);
const nul = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? undefined);
const text = (max: number) => z.string().max(max);
const money = z.number().int().min(0).max(MAX_MONEY);
const signedMoney = z.number().int().min(-MAX_MONEY).max(MAX_MONEY);
const when = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)))
  .transform((s) => new Date(s));
const stamps = { createdAt: nul(when), updatedAt: nul(when) };
const currency = nul(text(8));
const tags = nul(z.array(text(50)).max(50));

const accountSchema = z.object({
  id: oid,
  name: text(100).min(1),
  type: z.enum(["cash", "bank", "credit_card", "savings", "investment", "wallet"]),
  balance: signedMoney,
  currency,
  color: nul(text(32)),
  icon: nul(text(64)),
  isArchived: nul(z.boolean()),
  lowBalanceAt: nul(money),
  creditMeta: nul(
    z.object({
      creditLimit: nul(signedMoney),
      billingCycleDay: nul(z.number().int().min(1).max(31)),
      paymentDueDay: nul(z.number().int().min(1).max(31)),
      apr: nul(z.number().min(0).max(1000)),
      network: nul(z.enum(["visa", "mastercard", "amex", "rupay", "discover", "diners"])),
      lastFourDigits: nul(text(4)),
      cardholderName: nul(text(60)),
      minPaymentPct: nul(z.number().min(0).max(100)),
    })
  ),
  rewardRule: nul(
    z.object({
      kind: nul(z.enum(["cashback", "points"])),
      baseRate: nul(z.number().min(0).max(1000)),
      categoryRates: nul(z.array(z.object({ category: text(100).min(1), rate: z.number().min(0).max(1000) })).max(100)),
      cap: nul(z.number().min(1).max(MAX_MONEY)),
      pointValue: nul(z.number().min(1).max(MAX_MONEY)),
    })
  ),
  smsLastFour: nul(z.array(z.string().regex(/^\d{4}$/)).max(20)),
  deletedAt: nul(when),
  ...stamps,
});

const transactionSchema = z.object({
  id: oid,
  account: oid,
  type: z.enum(["income", "expense", "transfer"]),
  amount: money,
  currency,
  category: text(100).min(1),
  subcategory: nul(text(100)),
  description: nul(text(1000)),
  note: nul(text(5000)),
  date: when,
  tags,
  attachments: nul(z.array(z.string().max(2048).regex(/^https?:\/\//i)).max(20)),
  transferTo: nul(oid),
  isRecurring: nul(z.boolean()),
  recurringId: nul(oid),
  recurrenceFrequency: nul(z.enum(["daily", "weekly", "monthly", "yearly"])),
  recurrenceInterval: nul(z.number().int().min(1).max(1000)),
  recurrenceCount: nul(z.number().int().min(0).max(100_000)),
  recurrenceEndDate: nul(when),
  recurrenceLabel: nul(text(200)),
  recurrenceIsOpenEnded: nul(z.boolean()),
  recurrenceCancelled: nul(z.boolean()),
  installmentIndex: nul(z.number().int().min(0).max(100_000)),
  installmentStatus: nul(z.enum(["upcoming", "paid", "overdue", "skipped"])),
  paidAt: nul(when),
  splitGroupId: nul(oid),
  source: nul(z.enum(["manual", "sms", "notification", "n8n", "recurring", "import"])),
  reviewStatus: nul(z.enum(["unreviewed", "confirmed", "corrected", "voided"])),
  reviewedAt: nul(when),
  refundOf: nul(oid),
  refundStatus: nul(z.enum(["suggested", "confirmed", "rejected"])),
  refundPriorCategory: nul(text(100)),
  ...stamps,
});

const budgetSchema = z.object({
  id: oid,
  category: text(100).min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2200),
  limitAmount: money,
  currency,
  alertAt: nul(z.number().min(0).max(100)),
  rollover: nul(z.boolean()),
  isActive: nul(z.boolean()),
  ...stamps,
});

const goalSchema = z.object({
  id: oid,
  name: text(100).min(1),
  targetAmount: money,
  savedAmount: nul(money),
  currency,
  targetDate: nul(when),
  category: nul(text(100)),
  icon: nul(text(64)),
  roundUpEnabled: nul(z.boolean()),
  roundUpTo: nul(money),
  isCompleted: nul(z.boolean()),
  completedAt: nul(when),
  ...stamps,
});

const loanSchema = z.object({
  id: oid,
  direction: z.enum(["given", "received"]),
  counterparty: text(200).min(1),
  principalAmount: money,
  remainingAmount: money,
  currency,
  interestRate: nul(z.number().min(0).max(1000)),
  startDate: when,
  dueDate: nul(when),
  description: nul(text(1000)),
  isSettled: nul(z.boolean()),
  settledAt: nul(when),
  account: nul(oid),
  externalLoanId: nul(text(64)),
  ...stamps,
});

const repaymentSchema = z.object({
  id: oid,
  loan: oid,
  amount: money,
  date: when,
  note: nul(text(1000)),
  account: nul(oid),
  ...stamps,
});

const ruleSchema = z.object({
  id: oid,
  field: z.enum(["merchant", "upi", "text"]),
  op: nul(z.enum(["contains", "equals"])),
  value: text(200).min(1),
  valueKey: text(200).min(1),
  category: nul(text(100)),
  merchantName: nul(text(200)),
  account: nul(oid),
  tags,
  priority: nul(z.number().int().min(-1_000_000).max(1_000_000)),
  isActive: nul(z.boolean()),
  ...stamps,
});

const sinkingFundSchema = z.object({
  id: oid,
  name: text(100).min(1),
  targetAmount: money,
  savedAmount: nul(money),
  currency,
  dueDate: when,
  monthlyAmount: nul(money),
  icon: nul(text(64)),
  isCompleted: nul(z.boolean()),
  completedAt: nul(when),
  ...stamps,
});

const spendLimitSchema = z.object({
  dailyAmount: nul(z.number().int().min(1).max(MAX_MONEY)),
  weeklyAmount: nul(z.number().int().min(1).max(MAX_MONEY)),
  alertAt: nul(z.number().min(1).max(100)),
  excludeCategories: nul(z.array(text(100)).max(100)),
  rollover: nul(z.boolean()),
  pausedUntil: nul(when),
  limitHistory: nul(
    z
      .array(
        z.object({
          from: when,
          dailyAmount: nul(z.number().int().min(1).max(MAX_MONEY)),
          weeklyAmount: nul(z.number().int().min(1).max(MAX_MONEY)),
        })
      )
      .max(2000)
  ),
  ...stamps,
});

const decisionSchema = z.object({
  id: oid,
  key: text(300).min(1),
  merchant: text(200).min(1),
  status: z.enum(["detected", "confirmed", "dismissed"]),
  ...stamps,
});

const manualAssetSchema = z.object({
  id: oid,
  name: text(60).min(1),
  kind: nul(z.enum(["property", "vehicle", "gold", "investment", "other"])),
  value: money,
  note: nul(text(200)),
  isArchived: nul(z.boolean()),
  ...stamps,
});

const list = <T extends z.ZodType>(s: T, max: number) => nul(z.array(s).max(max)).transform((v) => v ?? []);

const dataSchema = z.object({
  accounts: list(accountSchema, CAPS.accounts),
  transactions: list(transactionSchema, CAPS.transactions),
  budgets: list(budgetSchema, CAPS.budgets),
  goals: list(goalSchema, CAPS.goals),
  loans: list(loanSchema, CAPS.loans),
  repayments: list(repaymentSchema, CAPS.repayments),
  rules: list(ruleSchema, CAPS.rules),
  sinkingFunds: list(sinkingFundSchema, CAPS.sinkingFunds),
  subscriptionDecisions: list(decisionSchema, CAPS.subscriptionDecisions),
  manualAssets: list(manualAssetSchema, CAPS.manualAssets),
  spendLimit: nul(spendLimitSchema),
});

export const payloadSchema = z.object({
  app: z.literal("expense-tracker"),
  version: z.literal(BACKUP_PAYLOAD_VERSION),
  createdAt: z.string().max(40),
  data: dataSchema,
});

export type BackupData = z.infer<typeof dataSchema>;
export type BackupPayload = z.infer<typeof payloadSchema>;
type Transaction_ = z.infer<typeof transactionSchema>;
type Repayment_ = z.infer<typeof repaymentSchema>;

export const COLLECTIONS = [
  "accounts",
  "loans",
  "goals",
  "budgets",
  "rules",
  "sinkingFunds",
  "manualAssets",
  "subscriptionDecisions",
  "transactions",
  "repayments",
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

// ── export ─────────────────────────────────────────────────────────────────

const wire = (doc: Record<string, unknown>) => {
  const { _id, ...rest } = doc;
  return { id: String(_id), ...(JSON.parse(JSON.stringify(rest)) as Record<string, unknown>) };
};

// One shared byte budget for the whole export: rows are read in batches and
// counted as they are serialised, so a huge account stops early instead of
// being loaded first.
type Budget = { bytes: number };

async function readAll<S extends z.ZodType>(
  model: AnyModel,
  filter: Record<string, unknown>,
  schema: S,
  cap: number,
  label: string,
  omitted: Record<string, number>,
  budget: Budget
): Promise<z.infer<S>[]> {
  const tooBig = () => new BackupError("too_large", `Too much data for one backup (${label})`);
  if ((await model.countDocuments(filter)) > cap) throw new BackupError("too_large", `Too many ${label} for one backup (limit ${cap})`);
  const out: z.infer<S>[] = [];
  for await (const doc of model.find(filter).sort({ _id: 1 }).lean<Record<string, unknown>[]>().cursor({ batchSize: 500 })) {
    const parsed = schema.safeParse(wire(doc as Record<string, unknown>));
    if (!parsed.success) {
      omitted[label] = (omitted[label] ?? 0) + 1;
      continue;
    }
    budget.bytes += JSON.stringify(parsed.data).length;
    if (budget.bytes > MAX_PLAIN_BYTES || out.length >= cap) throw tooBig();
    out.push(parsed.data);
  }
  return out;
}

export type BackupBuild = {
  payload: BackupPayload;
  counts: Record<CollectionName | "spendLimit", number>;
  omitted: Record<string, number>;
};

export async function buildBackup(userId: string): Promise<BackupBuild> {
  await connectDB();
  const user = new Types.ObjectId(userId);
  const omitted: Record<string, number> = {};
  const budget: Budget = { bytes: 0 };
  const live = { user, isDeleted: { $ne: true } };
  const m = <T,>(model: T) => model as unknown as AnyModel;

  const accounts = await readAll(m(Account), { user }, accountSchema, CAPS.accounts, "accounts", omitted, budget);
  const loans = await readAll(m(Loan), live, loanSchema, CAPS.loans, "loans", omitted, budget);
  const goals = await readAll(m(Goal), live, goalSchema, CAPS.goals, "goals", omitted, budget);
  const budgets = await readAll(m(Budget), live, budgetSchema, CAPS.budgets, "budgets", omitted, budget);
  const rules = await readAll(m(Rule), { user }, ruleSchema, CAPS.rules, "rules", omitted, budget);
  const sinkingFunds = await readAll(m(SinkingFund), live, sinkingFundSchema, CAPS.sinkingFunds, "sinkingFunds", omitted, budget);
  const manualAssets = await readAll(m(ManualAsset), { user }, manualAssetSchema, CAPS.manualAssets, "manualAssets", omitted, budget);
  const subscriptionDecisions = await readAll(
    m(SubscriptionDecision),
    { user },
    decisionSchema,
    CAPS.subscriptionDecisions,
    "subscriptionDecisions",
    omitted,
    budget
  );
  const transactions = await readAll(m(Transaction), live, transactionSchema, CAPS.transactions, "transactions", omitted, budget);
  const repayments = await readAll(m(Repayment), live, repaymentSchema, CAPS.repayments, "repayments", omitted, budget);
  const limitDoc = await SpendLimit.findOne({ user }).lean<Record<string, unknown> | null>();
  const parsedLimit = limitDoc ? spendLimitSchema.safeParse(wire(limitDoc)) : null;
  const spendLimit = parsedLimit?.success ? parsedLimit.data : undefined;
  if (limitDoc && !spendLimit) omitted.spendLimit = 1;

  // Deleted accounts go in too (still marked deleted): the balances of live
  // accounts include transfers to and from them, and their transactions stay
  // attached to something.
  // Keep the file self-consistent: a row that points at something that is not
  // in the file loses the pointer (or is dropped if it cannot stand alone).
  const drop = (name: string) => (omitted[name] = (omitted[name] ?? 0) + 1);
  const accountIds = new Set(accounts.map((a) => a.id));
  const keptTx = transactions.filter((t) => {
    const ok = accountIds.has(t.account) && (!t.transferTo || accountIds.has(t.transferTo));
    if (!ok) drop("transactions");
    return ok;
  });
  const txIds = new Set(keptTx.map((t) => t.id));
  for (const t of keptTx) {
    if (t.refundOf && !txIds.has(t.refundOf)) {
      t.refundOf = undefined;
      t.refundStatus = undefined;
      t.refundPriorCategory = undefined;
    }
  }
  for (const l of loans) if (l.account && !accountIds.has(l.account)) l.account = undefined;
  for (const r of rules) if (r.account && !accountIds.has(r.account)) r.account = undefined;
  const loanIds = new Set(loans.map((l) => l.id));
  const keptRepayments = repayments.filter((r) => {
    if (!loanIds.has(r.loan)) {
      drop("repayments");
      return false;
    }
    if (r.account && !accountIds.has(r.account)) r.account = undefined;
    return true;
  });

  const data: BackupData = {
    accounts,
    loans,
    goals,
    budgets,
    rules,
    sinkingFunds,
    manualAssets,
    subscriptionDecisions,
    transactions: keptTx,
    repayments: keptRepayments,
    spendLimit,
  };
  const counts = {
    accounts: accounts.length,
    loans: loans.length,
    goals: goals.length,
    budgets: budgets.length,
    rules: rules.length,
    sinkingFunds: sinkingFunds.length,
    manualAssets: manualAssets.length,
    subscriptionDecisions: subscriptionDecisions.length,
    transactions: keptTx.length,
    repayments: keptRepayments.length,
    spendLimit: spendLimit ? 1 : 0,
  };
  return {
    payload: { app: "expense-tracker", version: BACKUP_PAYLOAD_VERSION, createdAt: new Date().toISOString(), data },
    counts,
    omitted,
  };
}

// ── restore ────────────────────────────────────────────────────────────────

export type RestoreCounts = { inBackup: number; toCreate: number; existing: number };
export type RestoreReport = {
  dryRun: boolean;
  restored: boolean;
  backupCreatedAt: string;
  counts: Record<CollectionName | "spendLimit", RestoreCounts>;
  warnings: string[];
};

export function parsePayload(raw: unknown): BackupPayload {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issue.path.join(".") : "";
    const newer = typeof raw === "object" && raw !== null && (raw as { version?: unknown }).version !== BACKUP_PAYLOAD_VERSION;
    throw new BackupError(
      "invalid",
      newer ? "This backup was made by a newer version and cannot be restored here" : `The backup contents are not valid${where ? ` (${where})` : ""}`
    );
  }
  return parsed.data;
}

function invalid(message: string): never {
  throw new BackupError("invalid", message);
}

function checkConsistency(d: BackupData) {
  const ids = (rows: { id: string }[], label: string) => {
    const set = new Set<string>();
    for (const r of rows) {
      const id = r.id.toLowerCase();
      if (set.has(id)) invalid(`The backup lists the same ${label} twice`);
      set.add(id);
    }
    return set;
  };
  const accounts = ids(d.accounts, "account");
  const txs = ids(d.transactions, "transaction");
  const loans = ids(d.loans, "loan");
  ids(d.budgets, "budget");
  ids(d.goals, "goal");
  ids(d.rules, "rule");
  ids(d.sinkingFunds, "sinking fund");
  ids(d.manualAssets, "asset");
  ids(d.subscriptionDecisions, "subscription choice");
  ids(d.repayments, "repayment");
  const has = (set: Set<string>, id?: string) => !id || set.has(id.toLowerCase());
  for (const t of d.transactions) {
    if (!has(accounts, t.account) || !has(accounts, t.transferTo) || !has(txs, t.refundOf)) {
      invalid("The backup has a transaction that points at something missing");
    }
  }
  for (const l of d.loans) if (!has(accounts, l.account)) invalid("The backup has a loan that points at a missing account");
  for (const r of d.rules) if (!has(accounts, r.account)) invalid("The backup has a rule that points at a missing account");
  for (const r of d.repayments) {
    if (!has(loans, r.loan) || !has(accounts, r.account)) invalid("The backup has a repayment that points at something missing");
  }
}

type Held = { owner: string; trashed: boolean };

async function ownersOf(model: AnyModel, ids: string[]): Promise<Map<string, Held>> {
  const out = new Map<string, Held>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK).map((id) => new Types.ObjectId(id));
    const rows = await model
      .find({ _id: { $in: slice } }, { user: 1, isDeleted: 1, deletedAt: 1 })
      .lean<{ _id: Types.ObjectId; user?: Types.ObjectId; isDeleted?: boolean; deletedAt?: Date | null }[]>();
    for (const r of rows) out.set(String(r._id), { owner: r.user ? String(r.user) : "", trashed: r.isDeleted === true || Boolean(r.deletedAt) });
  }
  return out;
}

// The id a row gets when the file's own id is held by someone else. The same
// (person, kind, original id) always gives the same id, so running a restore
// again finds the rows it made and skips them instead of copying them.
const derivedId = (userId: string, kind: string, id: string) =>
  new Types.ObjectId(createHash("sha256").update(`${userId}:${kind}:${id}`).digest("hex").slice(0, 24)).toHexString();

type Planned = { final: Map<string, string>; create: Set<string>; existing: Set<string>; trashed: number };

// For each row: mine already -> keep, skip; free -> keep id, create; held by
// someone else -> a derived id (mine already -> skip, else create). Nothing is
// ever overwritten.
async function plan(model: AnyModel, kind: string, rows: { id: string }[], userId: string): Promise<Planned> {
  const ids = rows.map((r) => r.id.toLowerCase());
  const owners = await ownersOf(model, ids);
  const final = new Map<string, string>();
  const create = new Set<string>();
  const existing = new Set<string>();
  let trashed = 0;
  const moved: string[] = [];
  for (const id of ids) {
    const held = owners.get(id);
    if (held?.owner === userId) {
      final.set(id, id);
      existing.add(id);
      if (held.trashed) trashed += 1;
    } else if (held) {
      moved.push(id);
    } else {
      final.set(id, id);
      create.add(id);
    }
  }
  const derived = new Map(moved.map((id) => [id, derivedId(userId, kind, id)]));
  const derivedHeld = await ownersOf(model, [...derived.values()]);
  for (const [id, d] of derived) {
    const held = derivedHeld.get(d);
    final.set(id, d);
    if (held?.owner === userId) {
      existing.add(id);
      if (held.trashed) trashed += 1;
    } else if (held) {
      throw new BackupError("invalid", "Could not place a row from the backup");
    } else {
      create.add(id);
    }
  }
  return { final, create, existing, trashed };
}

// A recurring series or split group is only an id shared by rows. If another
// person's rows already carry the file's id, this person's rows get a derived
// one instead, so they never join a series that is not theirs.
async function groupIds(userId: string, txs: { recurringId?: string; splitGroupId?: string }[]) {
  const wanted = new Set<string>();
  for (const t of txs) {
    if (t.recurringId) wanted.add(t.recurringId.toLowerCase());
    if (t.splitGroupId) wanted.add(t.splitGroupId.toLowerCase());
  }
  const foreign = new Set<string>();
  const all = [...wanted];
  for (let i = 0; i < all.length; i += CHUNK) {
    const slice = all.slice(i, i + CHUNK).map((id) => new Types.ObjectId(id));
    for (const field of ["recurringId", "splitGroupId"] as const) {
      const rows = await Transaction.find({ [field]: { $in: slice }, user: { $ne: new Types.ObjectId(userId) } }, { [field]: 1 }).lean<
        Record<string, Types.ObjectId>[]
      >();
      for (const r of rows) foreign.add(String(r[field]));
    }
  }
  return (id?: string) => (id ? (foreign.has(id.toLowerCase()) ? derivedId(userId, "group", id.toLowerCase()) : id.toLowerCase()) : undefined);
}

async function insertChunks(model: AnyModel, docs: Record<string, unknown>[]) {
  for (let i = 0; i < docs.length; i += CHUNK) {
    await model.insertMany(docs.slice(i, i + CHUNK) as Record<string, unknown>[], { ordered: true });
  }
}

const strip = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));

export async function restoreBackup(userId: string, payload: BackupPayload, opts: { dryRun: boolean }): Promise<RestoreReport> {
  await connectDB();
  const d = payload.data;
  checkConsistency(d);
  const user = new Types.ObjectId(userId);
  const m = <T,>(model: T) => model as unknown as AnyModel;

  const accounts = await plan(m(Account), "account", d.accounts, userId);
  const loans = await plan(m(Loan), "loan", d.loans, userId);
  const goals = await plan(m(Goal), "goal", d.goals, userId);
  const sinking = await plan(m(SinkingFund), "fund", d.sinkingFunds, userId);
  const assets = await plan(m(ManualAsset), "asset", d.manualAssets, userId);
  const txs = await plan(m(Transaction), "transaction", d.transactions, userId);
  const repayments = await plan(m(Repayment), "repayment", d.repayments, userId);

  const group = await groupIds(userId, d.transactions);

  // Budgets, rules and subscription choices also have a unique key per person.
  const budgetKey = (b: { category: string; year: number; month: number }) => `${b.category}|${b.year}|${b.month}`;
  const haveBudgets = new Set(
    (await Budget.find({ user, isDeleted: { $ne: true } }, { category: 1, year: 1, month: 1 }).lean<{ category: string; year: number; month: number }[]>()).map(budgetKey)
  );
  const ruleKey = (r: { field: string; op?: string; valueKey: string }) => `${r.field}|${r.op ?? "contains"}|${r.valueKey}`;
  const haveRules = new Set(
    (await Rule.find({ user }, { field: 1, op: 1, valueKey: 1 }).lean<{ field: string; op?: string; valueKey: string }[]>()).map(ruleKey)
  );
  const haveDecisions = new Set((await SubscriptionDecision.find({ user }, { key: 1 }).lean<{ key: string }[]>()).map((r) => r.key));
  const hasLimit = Boolean(await SpendLimit.exists({ user }));

  const pick = <T,>(rows: T[], taken: Set<string>, key: (r: T) => string) =>
    rows.filter((r) => {
      const k = key(r);
      if (taken.has(k)) return false;
      taken.add(k);
      return true;
    });
  const budgets = pick(d.budgets, haveBudgets, budgetKey);
  const rules = pick(d.rules, haveRules, ruleKey);
  const decisions = pick(d.subscriptionDecisions, haveDecisions, (r) => r.key);

  const fin = (p: Planned, id?: string) => (id ? p.final.get(id.toLowerCase()) : undefined);
  const mine = (p: Planned) => (r: { id: string }) => p.create.has(r.id.toLowerCase());

  const newAccounts = d.accounts.filter(mine(accounts));
  const newLoans = d.loans.filter(mine(loans));
  const newGoals = d.goals.filter(mine(goals));
  const newFunds = d.sinkingFunds.filter(mine(sinking));
  const newAssets = d.manualAssets.filter(mine(assets));
  const newTxs = d.transactions.filter(mine(txs));
  const newRepayments = d.repayments.filter(mine(repayments));

  const warnings: string[] = [];
  const intoOld = newTxs.filter((t) => accounts.existing.has(t.account.toLowerCase())).length;
  if (intoOld > 0) {
    warnings.push(
      `${intoOld} transaction${intoOld === 1 ? "" : "s"} will be added to accounts that already exist here. Those accounts' balances are not changed, so check them afterwards.`
    );
  }
  const repaidOld = newRepayments.filter((r) => loans.existing.has(r.loan.toLowerCase())).length;
  if (repaidOld > 0) {
    warnings.push(
      `${repaidOld} repayment${repaidOld === 1 ? "" : "s"} will be added to loans that already exist here. Those loans' remaining amounts are not changed.`
    );
  }

  const trashed = [accounts, loans, goals, sinking, assets, txs, repayments].reduce((n, p) => n + p.trashed, 0);
  if (trashed > 0) {
    warnings.push(`${trashed} row${trashed === 1 ? "" : "s"} in the backup already exist in your trash and ${trashed === 1 ? "was" : "were"} not restored.`);
  }

  const count = (inBackup: number, toCreate: number): RestoreCounts => ({ inBackup, toCreate, existing: inBackup - toCreate });
  const limitCreate = d.spendLimit && !hasLimit ? 1 : 0;
  const counts: RestoreReport["counts"] = {
    accounts: count(d.accounts.length, newAccounts.length),
    loans: count(d.loans.length, newLoans.length),
    goals: count(d.goals.length, newGoals.length),
    budgets: count(d.budgets.length, budgets.length),
    rules: count(d.rules.length, rules.length),
    sinkingFunds: count(d.sinkingFunds.length, newFunds.length),
    manualAssets: count(d.manualAssets.length, newAssets.length),
    subscriptionDecisions: count(d.subscriptionDecisions.length, decisions.length),
    transactions: count(d.transactions.length, newTxs.length),
    repayments: count(d.repayments.length, newRepayments.length),
    spendLimit: count(d.spendLimit ? 1 : 0, limitCreate),
  };
  const base = { backupCreatedAt: payload.createdAt, counts, warnings };
  if (opts.dryRun) return { dryRun: true, restored: false, ...base };

  // Parents first so every reference points at a row that exists.
  const owned = { user };
  await insertChunks(
    m(Account),
    newAccounts.map((a) => strip({ ...a, ...owned, _id: fin(accounts, a.id), id: undefined }))
  );
  await insertChunks(
    m(Loan),
    newLoans.map((l) => strip({ ...l, ...owned, _id: fin(loans, l.id), id: undefined, account: fin(accounts, l.account) }))
  );
  await insertChunks(m(Goal), newGoals.map((g) => strip({ ...g, ...owned, _id: fin(goals, g.id), id: undefined })));
  await insertChunks(m(Budget), budgets.map((b) => strip({ ...b, ...owned, _id: new Types.ObjectId(), id: undefined })));
  await insertChunks(
    m(Rule),
    rules.map((r) => strip({ ...r, ...owned, _id: new Types.ObjectId(), id: undefined, account: fin(accounts, r.account) }))
  );
  await insertChunks(m(SinkingFund), newFunds.map((f) => strip({ ...f, ...owned, _id: fin(sinking, f.id), id: undefined })));
  await insertChunks(m(ManualAsset), newAssets.map((a) => strip({ ...a, ...owned, _id: fin(assets, a.id), id: undefined })));
  await insertChunks(
    m(SubscriptionDecision),
    decisions.map((s) => strip({ ...s, ...owned, _id: new Types.ObjectId(), id: undefined }))
  );
  await insertChunks(
    m(Transaction),
    newTxs.map((t: Transaction_) =>
      strip({
        ...t,
        ...owned,
        _id: fin(txs, t.id),
        id: undefined,
        account: fin(accounts, t.account),
        transferTo: fin(accounts, t.transferTo),
        refundOf: fin(txs, t.refundOf),
        recurringId: group(t.recurringId),
        splitGroupId: group(t.splitGroupId),
      })
    )
  );
  await insertChunks(
    m(Repayment),
    newRepayments.map((r: Repayment_) =>
      strip({ ...r, ...owned, _id: fin(repayments, r.id), id: undefined, loan: fin(loans, r.loan), account: fin(accounts, r.account) })
    )
  );
  if (d.spendLimit && !hasLimit) await insertChunks(m(SpendLimit), [strip({ ...d.spendLimit, ...owned })]);

  return { dryRun: false, restored: true, ...base };
}
