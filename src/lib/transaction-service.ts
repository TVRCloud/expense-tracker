import mongoose, { type ClientSession, Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import type { AuthUser } from "@/lib/auth-guard";
import { redis } from "@/lib/redis";
import { checkBudgetAlert } from "@/lib/budget-alert";
import { detectAnomalies, retireAnomaliesForTransactions, type CheckedTransaction } from "@/lib/anomaly-service";
import { runInBackground } from "@/lib/perf/background";
import { checkSpendLimitAlert } from "@/lib/spend-limit";
import { applyRoundUp } from "@/lib/goal-service";
import { computeInstallmentDates, OPEN_ENDED_WINDOW } from "@/lib/recurrence";
import { appendLedgerBlock } from "@/lib/ledger";
import { ruleOverridesForTransaction } from "@/lib/rule-service";
import logger from "@/lib/logger";
import { isReservedTag, MAX_TAGS, mergeUserTags, normaliseTags, tagListSchema } from "@/lib/tags";
import { deleteReceiptsOfTransaction } from "@/lib/receipt-service";
import { getBaseState, lockBaseCurrency, type BaseState } from "@/lib/base-currency";
import { BASE_CURRENCY_ONLY_TWO_DECIMALS, isSupportedAsBase, convertMinor, CurrencyError, isSupportedCurrency, MAX_MINOR_AMOUNT, minorExponent } from "@/lib/currency";
import { getRate, RateUnavailableError } from "@/lib/exchange-rate-service";

// Shared transaction-creation business logic, used by both the browser-facing
// POST /api/transactions route and the n8n-facing POST /api/integrations/transactions
// route. Do not duplicate this logic in either caller — extend it here instead.
//
// This preserves the app's existing (weaker) consistency model exactly: no
// mongoose sessions/transactions are used anywhere in this codebase, so
// mutations below remain sequential and non-atomic, same as before extraction.

export const MAX_SPLIT_LINES = 20;

export const splitLineSchema = z.object({
  category: z.string().trim().min(1),
  amount: z.number().int().positive().max(MAX_MINOR_AMOUNT),
  description: z.string().optional(),
});

export const transactionCreateSchema = z
  .object({
    accountId: z.string(),
    type: z.enum(["income", "expense", "transfer"]),
    // Paise of the base currency. Leave out when sending originalAmount.
    amount: z.number().int().positive().max(MAX_MINOR_AMOUNT).optional(),
    // Only the base currency's code is accepted (another code is a 400: send
    // originalAmount and originalCurrency instead). A stored row's currency is
    // always the base currency.
    currency: z.string().optional(),
    // Foreign spend: minor units of originalCurrency (cents, yen, fils...).
    // The server converts to the base currency and sets `amount`.
    originalAmount: z.number().int().positive().max(MAX_MINOR_AMOUNT).optional(),
    originalCurrency: z.string().refine(isSupportedCurrency, "Unsupported currency").optional(),
    // Base units per 1 unit of originalCurrency; the server's own rate is used when omitted.
    rate: z.number().positive().finite().optional(),
    category: z.string().min(1).optional(),
    subcategory: z.string().optional(),
    description: z.string().optional(),
    note: z.string().optional(),
    date: z.string(),
    tags: tagListSchema.default([]),
    transferToId: z.string().optional(),
    isRecurring: z.boolean().default(false),
    recurrenceFrequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
    recurrenceInterval: z.number().int().min(1).max(60).optional(),
    recurrenceCount: z.number().int().min(1).max(3650).optional(),
    recurrenceEndDate: z.string().optional(),
    recurrenceLabel: z.string().max(100).optional(),
    // Split-purchase lines — when present, `category` above is ignored and
    // one sibling Transaction document is created per split line instead
    // (see splitGroupId on the model). Sum of split amounts must equal `amount`.
    splits: z.array(splitLineSchema).min(2).max(MAX_SPLIT_LINES).optional(),
  })
  .superRefine((data, ctx) => {
    if (!Types.ObjectId.isValid(data.accountId)) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Invalid account" });
    }
    const foreign = data.originalAmount !== undefined || data.originalCurrency !== undefined;
    if (foreign) {
      if (data.originalAmount === undefined || data.originalCurrency === undefined) {
        ctx.addIssue({ code: "custom", path: ["originalAmount"], message: "Send originalAmount and originalCurrency together" });
      }
      if (data.amount !== undefined) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Send either amount or originalAmount, not both" });
      }
      if (data.type === "transfer") {
        ctx.addIssue({ code: "custom", path: ["originalAmount"], message: "Transfers must be in the base currency" });
      }
      if (data.splits) {
        ctx.addIssue({ code: "custom", path: ["originalAmount"], message: "Split transactions must be in the base currency" });
      }
      if (data.isRecurring) {
        ctx.addIssue({ code: "custom", path: ["originalAmount"], message: "Recurring transactions must be in the base currency" });
      }
    } else {
      if (data.amount === undefined) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount is required" });
      }
      if (data.rate !== undefined) {
        ctx.addIssue({ code: "custom", path: ["rate"], message: "rate only applies with originalAmount" });
      }
    }
    if (data.splits) {
      if (data.type !== "expense") {
        ctx.addIssue({ code: "custom", path: ["splits"], message: "Only expenses can be split" });
      }
      if (data.isRecurring) {
        ctx.addIssue({ code: "custom", path: ["splits"], message: "Split transactions can't be recurring" });
      }
      const splitTotal = data.splits.reduce((sum, s) => sum + s.amount, 0);
      if (data.amount !== undefined && splitTotal !== data.amount) {
        ctx.addIssue({ code: "custom", path: ["splits"], message: "Split amounts must add up to the total" });
      }
    } else if (!data.category) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Category is required" });
    }
    if (data.transferToId && !Types.ObjectId.isValid(data.transferToId)) {
      ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Invalid transfer account" });
    }
    if (data.type === "transfer" && !data.transferToId) {
      ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination is required" });
    }
    if (data.type !== "transfer" && data.transferToId) {
      ctx.addIssue({
        code: "custom",
        path: ["transferToId"],
        message: "Transfer destination is only allowed for transfers",
      });
    }
    if (data.type === "transfer" && data.transferToId === data.accountId) {
      ctx.addIssue({ code: "custom", path: ["transferToId"], message: "Transfer destination must be different" });
    }
    if (data.type === "transfer" && data.isRecurring) {
      ctx.addIssue({ code: "custom", path: ["isRecurring"], message: "Recurring transfers are not supported" });
    }
  });

// Provenance for auto-captured transactions. Deliberately not part of
// transactionCreateSchema, so browser and integration callers can't set it
// from a request body; only server code (src/lib/capture/*) passes it.
export type TransactionProvenance = {
  source: "sms" | "notification" | "n8n" | "aa" | "manual" | "import";
  sourceCapture?: string;
  captures?: string[];
  reviewStatus?: "unreviewed" | "confirmed" | null;
  // A bank-link row older than the link: history the balance already reflects.
  // It leaves budget and spend limit alerts and the round-up alone (callers
  // also pass skipBalance), but categorise rules still apply.
  historical?: boolean;
  // Household editor who added the row to a shared account (single rows only). The owner's round-up
  // into a goal is skipped for such a row; budget and spend limit alerts still run.
  addedBy?: string;
};

export type CreateTransactionInput = z.infer<typeof transactionCreateSchema> & {
  userId: string;
  actor: AuthUser;
  provenance?: TransactionProvenance;
  // The bank message text, so a "text contains" categorise rule can match a
  // capture. Server code only (like provenance); never read from a request body.
  ruleText?: string;
  // Server code only. A statement import records history the account balance
  // already reflects, so it can leave the balance alone. Plain income and
  // expense rows only; a "import" source also skips budget and spend limit
  // alerts and the round-up, which are about spending now, not old rows.
  skipBalance?: boolean;
};

export type CreateTransactionResult =
  | { kind: "single"; transaction: unknown }
  | { kind: "series"; transaction: unknown; seriesId: string; count: number }
  | { kind: "split"; transaction: unknown; splitGroupId: string; count: number };

export type TransactionServiceErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "TRANSFER_ACCOUNT_NOT_FOUND"
  | "RATE_UNAVAILABLE"
  | "CONVERSION_FAILED"
  | "RATE_OUT_OF_BAND"
  | "CURRENCY_MISMATCH"
  | "UNSUPPORTED_BASE_CURRENCY"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_LOCKED"
  | "INSTALLMENT_NOT_FOUND"
  | "INVALID_SPLIT"
  | "TOO_MANY_RECEIPTS";

export class TransactionServiceError extends Error {
  code: TransactionServiceErrorCode;

  constructor(code: TransactionServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TransactionServiceError";
  }
}

export const transactionUpdateSchema = z.object({
  description: z.string().optional(),
  note: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  tags: tagListSchema.optional(),
  date: z.string().optional(),
});

export type UpdateTransactionInput = z.infer<typeof transactionUpdateSchema> & {
  userId: string;
  transactionId: string;
  actor: AuthUser;
};

function hasRepaymentTag(tags?: unknown[]) {
  return (tags ?? []).some((tag) => typeof tag === "string" && tag.startsWith("repayment:"));
}

export async function getLinkedTransactionBlocker(userId: string, transactionId: string, tags?: unknown[], session?: ClientSession) {
  const linkedStatement = await CreditStatement.findOne({
    user: userId,
    paymentTransactionId: transactionId,
    isDeleted: { $ne: true },
  }).select("_id").session(session ?? null).lean();
  if (linkedStatement) return "This transaction is linked to a credit statement payment.";
  if (hasRepaymentTag(tags)) return "This transaction is linked to a loan repayment.";
  return null;
}

async function invalidateStatsCache(userId: string, date: Date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  try {
    await redis?.del(`stats:v2:${userId}:${year}:${month}`);
  } catch {
    // Redis unavailable
  }
}

export async function invalidateStatsCacheMany(userId: string, dates: Date[]) {
  if (!redis) return;
  const keys = new Set<string>();
  for (const d of dates) {
    keys.add(`stats:v2:${userId}:${d.getFullYear()}:${d.getMonth() + 1}`);
  }
  try {
    await Promise.all([...keys].map((k) => redis!.del(k)));
  } catch {
    // Redis unavailable
  }
}

type ResolvedAmount = {
  amount: number;
  baseCurrency: string;
  stored: {
    originalAmount?: number;
    originalCurrency?: string;
    originalExponent?: number;
    rate?: number;
    rateDate?: Date;
    rateSource?: "provider" | "client";
  };
};

// Works out the base-currency `amount` and the foreign-spend fields to store.
// Plain base-currency requests pass through untouched.
async function resolveAmount(
  state: BaseState,
  input: { amount?: number; currency?: string; originalAmount?: number; originalCurrency?: string; rate?: number }
): Promise<ResolvedAmount> {
  const baseCurrency = state.base;
  // A base with other than two decimals (set before this rule existed) cannot
  // be written to: the app and parts of the server read base money as hundredths.
  if (!isSupportedAsBase(baseCurrency)) {
    throw new TransactionServiceError("UNSUPPORTED_BASE_CURRENCY", BASE_CURRENCY_ONLY_TWO_DECIMALS);
  }
  if (input.originalAmount === undefined || input.originalCurrency === undefined) {
    if (input.amount === undefined) throw new Error("createTransaction needs amount or originalAmount");
    if (input.currency !== undefined && input.currency !== baseCurrency) {
      throw new TransactionServiceError(
        "CURRENCY_MISMATCH",
        `Amounts are in ${baseCurrency}. For ${input.currency}, send originalAmount and originalCurrency instead of amount.`
      );
    }
    return { amount: input.amount, baseCurrency, stored: {} };
  }
  const { originalAmount, originalCurrency } = input;
  if (originalCurrency === baseCurrency) {
    // Same currency as the base: nothing to convert.
    return { amount: originalAmount, baseCurrency, stored: {} };
  }
  try {
    const resolved = await getRate(originalCurrency, baseCurrency, input.rate);
    return {
      amount: convertMinor(originalAmount, originalCurrency, baseCurrency, resolved.rate),
      baseCurrency,
      stored: {
        originalAmount,
        originalCurrency,
        originalExponent: minorExponent(originalCurrency),
        rate: resolved.rate,
        ...(resolved.rateDate ? { rateDate: resolved.rateDate } : {}),
        rateSource: resolved.source,
      },
    };
  } catch (err) {
    if (err instanceof RateUnavailableError) throw new TransactionServiceError("RATE_UNAVAILABLE", err.message);
    if (err instanceof CurrencyError && err.code === "RATE_OUT_OF_BAND") {
      throw new TransactionServiceError("RATE_OUT_OF_BAND", err.message);
    }
    if (err instanceof CurrencyError) throw new TransactionServiceError("CONVERSION_FAILED", err.message);
    throw err;
  }
}

/**
 * Ledger blocks for a create are written after its database transaction commits (the ledger is a per-person hash
 * chain whose appends retry on a sequence clash, which cannot be done inside a database transaction). By then the
 * row and the balance are committed, so a ledger failure must not turn the create into an error: the caller would
 * retry and book the payment twice. It is logged instead; the gap is not repaired automatically.
 */
async function appendLedgerAfterCommit(input: Parameters<typeof appendLedgerBlock>[0]) {
  try {
    await appendLedgerBlock(input);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.name : "unknown", scope: input.scope, entityId: input.entityId },
      "ledger block not written after a committed create"
    );
  }
}

/**
 * Runs `work` in one database transaction (production Mongo is a replica set, see docs/realtime.md): everything it
 * writes commits together or not at all, and a write conflict runs it again on the new state, so it must start from
 * nothing each time.
 */
async function inOneTransaction(work: (session: ClientSession) => Promise<void>): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await work(session);
    });
  } finally {
    await session.endSession();
  }
}

export async function createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
  const { userId, actor, accountId, transferToId, provenance, ruleText, skipBalance, ...restIn } = input;
  const isImport = provenance?.source === "import";
  const quiet = isImport || provenance?.historical === true;
  await connectDB();

  const account = await Account.findOne({ _id: accountId, user: userId, isArchived: { $ne: true } });
  if (!account) {
    throw new TransactionServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  }
  if (transferToId) {
    const transferAccount = await Account.findOne({ _id: transferToId, user: userId, isArchived: { $ne: true } });
    if (!transferAccount) {
      throw new TransactionServiceError("TRANSFER_ACCOUNT_NOT_FOUND", "Transfer account not found");
    }
  }

  // Read the base, run every check and the conversion, and only then lock the
  // base (right before anything is written): a rejected request must not pin
  // an empty user's base currency. If the base changed between the read and
  // the lock, redo the work against the base now in force.
  const baseState = await getBaseState(userId);
  let foreignFields = await resolveAmount(baseState, restIn);
  const lockedBase = await lockBaseCurrency(userId, baseState);
  if (lockedBase !== baseState.base) {
    foreignFields = await resolveAmount({ base: lockedBase, locked: true }, restIn);
  }
  // `currency` is the base currency's code and `amount` is paise of it; the
  // schema guarantees an amount exists once resolveAmount has run.
  const { currency: _ignoredCurrency, originalAmount: _a, originalCurrency: _c, rate: _r, ...restBase } = restIn;
  const rest = { ...restBase, amount: foreignFields.amount, currency: foreignFields.baseCurrency };
  const startDate = new Date(rest.date);

  // Categorise rules (src/lib/rule-service.ts) fill in what the person left
  // at the default: category still "other", a merchant name that came from a
  // bank message. Plain transactions only, and never an import (the preview
  // shows the file's own category and description, so they are written as shown); splits, series and transfers are
  // always exactly what was asked for.
  if (!rest.splits && !rest.isRecurring && rest.type !== "transfer" && !isImport) {
    const overrides = await ruleOverridesForTransaction(userId, {
      category: rest.category,
      description: rest.description,
      note: rest.note,
      tags: rest.tags,
      text: ruleText,
      descriptionFromCapture: Boolean(provenance && provenance.source !== "manual"),
    }).catch((err) => {
      logger.error({ err, userId }, "categorise rules failed; creating the transaction without them");
      return null;
    });
    if (overrides) {
      if (overrides.category) rest.category = overrides.category;
      if (overrides.description) rest.description = overrides.description;
      // A rule can only add plain tags, never the link tags the server owns.
      if (overrides.tags) rest.tags = normaliseTags(overrides.tags).filter((t) => !isReservedTag(t)).slice(0, MAX_TAGS);
    }
  }

  // ── Split purchase — N sibling documents sharing a splitGroupId ─────────
  // (schema refine above already guarantees rest.type === "expense",
  // !rest.isRecurring, and splits summing to rest.amount when this is set)
  if (rest.splits) {
    const splitGroupId = new Types.ObjectId();
    const { splits, category: _unusedCategory, ...sharedRest } = rest;
    const docs = splits.map((s) => ({
      ...sharedRest,
      category: s.category,
      amount: s.amount,
      description: s.description ?? sharedRest.description,
      ...(skipBalance ? { balanceApplied: false } : {}),
      account: accountId,
      user: userId,
      date: startDate,
      splitGroupId,
    }));
    // The rows and the balance move commit together or not at all (a replica set, as for editing a split).
    // An import of history (skipBalance) leaves the balance alone, as for a single row.
    const accountBefore = account.toObject();
    let accountAfter: unknown = null;
    let inserted: CheckedTransaction[] = [];
    await inOneTransaction(async (session) => {
      accountAfter = null;
      if (!skipBalance) {
        // Atomic $inc (not read-modify-write + save) so concurrent captures on
        // the same account can't overwrite each other's balance change.
        accountAfter = await Account.findOneAndUpdate(
          { _id: account._id, user: userId, isArchived: { $ne: true } },
          { $inc: { balance: -rest.amount } },
          { new: true, session }
        );
        // Archived since it was read: roll everything back rather than move a balance nobody can see.
        if (!accountAfter) throw new TransactionServiceError("ACCOUNT_NOT_FOUND", "Account not found");
      }
      inserted = (await Transaction.insertMany(docs, { session })) as unknown as CheckedTransaction[];
    });
    if (!skipBalance) {
      await appendLedgerAfterCommit({
        userId,
        scope: "account",
        entityId: account._id.toString(),
        action: "update",
        before: accountBefore,
        after: accountAfter,
        actor,
      });
    }
    for (const transaction of inserted) {
      await appendLedgerAfterCommit({
        userId,
        scope: "transaction",
        entityId: transaction._id.toString(),
        action: "create",
        after: transaction,
        actor,
      });
    }
    await invalidateStatsCache(userId, startDate);
    // An import is history: no alerts and no round-up, as for a single row.
    if (!quiet) {
      for (const s of splits) {
        void checkBudgetAlert(userId, s.category, s.amount, startDate);
      }
      // One line of a split is not a purchase: only the category jump is checked, once per distinct category.
      const seenCategories = new Set<string>();
      for (const line of inserted) {
        if (seenCategories.has(line.category)) continue;
        seenCategories.add(line.category);
        runInBackground("anomalies", () => detectAnomalies(userId, line, { splitLine: true }));
      }
      void checkSpendLimitAlert(userId);
      if (!provenance?.addedBy) {
        void applyRoundUp(userId, rest.amount, actor).catch((err) =>
          logger.error({ err, userId }, "applyRoundUp failed")
        );
      }
    }

    logger.info({ userId, splitGroupId: splitGroupId.toString(), count: docs.length }, "Split transaction created");
    return { kind: "split", transaction: inserted[0], splitGroupId: splitGroupId.toString(), count: docs.length };
  }

  // ── Bulk-create recurring installments ──────────────────────────────────
  // Explicit count/end-date series materialize exactly what the user asked for.
  // Open-ended series (no count, no end date — e.g. a recurring salary) only get
  // a small rolling window; topUpRecurringSeries() extends it as installments are consumed.
  const isOpenEnded = Boolean(
    rest.isRecurring && rest.recurrenceFrequency && !rest.recurrenceCount && !rest.recurrenceEndDate
  );
  const installmentCount = rest.isRecurring && rest.recurrenceFrequency
    ? (rest.recurrenceCount ?? (isOpenEnded ? OPEN_ENDED_WINDOW : 1))
    : 0;

  if (rest.isRecurring && installmentCount > 1 && rest.recurrenceFrequency) {
    const recurringId = new Types.ObjectId();
    const interval = rest.recurrenceInterval ?? 1;
    const dates = computeInstallmentDates(startDate, rest.recurrenceFrequency, interval, installmentCount);

    // No balance update at creation — installments only affect balance when marked paid
    const docs = dates.map((d, i) => ({
      ...rest,
      recurrenceCount: isOpenEnded ? undefined : installmentCount,
      recurrenceIsOpenEnded: isOpenEnded,
      account: accountId,
      user: userId,
      date: d,
      recurringId,
      installmentIndex: i,
      installmentStatus: "upcoming" as const,
      recurrenceInterval: interval,
      recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
      ...(transferToId ? { transferTo: transferToId } : {}),
    }));

    const inserted = await Transaction.insertMany(docs);
    for (const transaction of inserted) {
      await appendLedgerAfterCommit({
        userId,
        scope: "transaction",
        entityId: transaction._id.toString(),
        action: "create",
        after: transaction,
        actor,
      });
    }
    await invalidateStatsCacheMany(userId, dates);

    logger.info({ userId, recurringId: recurringId.toString(), count: docs.length }, "Recurring series created");
    return { kind: "series", transaction: inserted[0], seriesId: recurringId.toString(), count: docs.length };
  }

  // ── Single transaction (non-recurring or recurring count = 1) ───────────
  // The row and the balance move(s) commit together or not at all: a failure (or a crash) between the two writes
  // leaves neither, so a retry applies the balance once. Ledger blocks are written after the commit, from what
  // the transaction changed.
  const accountBefore = account.toObject();
  const transferBefore = rest.type === "transfer" && transferToId && !skipBalance ? await Account.findOne({ _id: transferToId, user: userId }).lean() : null;
  let transaction!: Awaited<ReturnType<typeof Transaction.create>>[number];
  let accountAfter: unknown = null;
  let transferAfter: unknown = null;
  await inOneTransaction(async (session) => {
    accountAfter = null;
    transferAfter = null;
    const [created] = await Transaction.create(
      [
        {
          ...rest,
          ...foreignFields.stored,
          ...(provenance ?? {}),
          ...(skipBalance ? { balanceApplied: false } : {}),
          account: accountId,
          user: userId,
          date: startDate,
          recurrenceInterval: rest.isRecurring ? (rest.recurrenceInterval ?? 1) : undefined,
          recurrenceEndDate: rest.recurrenceEndDate ? new Date(rest.recurrenceEndDate) : undefined,
          ...(transferToId ? { transferTo: transferToId } : {}),
        },
      ],
      { session }
    );
    transaction = created;
    if (!skipBalance) {
      const balanceDelta = rest.type === "income" ? rest.amount : -rest.amount;
      accountAfter = await Account.findOneAndUpdate({ _id: account._id, user: userId, isArchived: { $ne: true } }, { $inc: { balance: balanceDelta } }, { new: true, session });
      if (!accountAfter) throw new TransactionServiceError("ACCOUNT_NOT_FOUND", "Account not found");
    }
    // A transfer written as history leaves both sides alone, as the source side does.
    if (rest.type === "transfer" && transferToId && !skipBalance) {
      transferAfter = await Account.findOneAndUpdate({ _id: transferToId, user: userId, isArchived: { $ne: true } }, { $inc: { balance: rest.amount } }, { new: true, session });
      if (!transferAfter) throw new TransactionServiceError("TRANSFER_ACCOUNT_NOT_FOUND", "Transfer account not found");
    }
  });
  if (!skipBalance) {
    await appendLedgerAfterCommit({
      userId,
      scope: "account",
      entityId: account._id.toString(),
      action: "update",
      before: accountBefore,
      after: accountAfter,
      actor,
    });
  }
  if (transferBefore && transferAfter) {
    await appendLedgerAfterCommit({
      userId,
      scope: "account",
      entityId: transferToId!,
      action: "update",
      before: transferBefore,
      after: transferAfter,
      actor,
    });
  }
  await appendLedgerAfterCommit({
    userId,
    scope: "transaction",
    entityId: transaction._id.toString(),
    action: "create",
    after: transaction,
    actor,
  });
  await invalidateStatsCache(userId, startDate);

  if (rest.type === "expense" && !quiet) {
    // schema refine guarantees category is set for any non-split expense
    void checkBudgetAlert(userId, rest.category as string, rest.amount, startDate);
    void checkSpendLimitAlert(userId);
    // A row a household editor added is not the owner's own spending: no round-up into their goal.
    if (!provenance?.addedBy) {
      void applyRoundUp(userId, rest.amount, actor).catch((err) =>
        logger.error({ err, userId }, "applyRoundUp failed")
      );
    }
    // Unusual-spend alerts (src/lib/anomaly-service.ts). A scheduled bill is not a surprise; never throws.
    if (!rest.isRecurring) runInBackground("anomalies", () => detectAnomalies(userId, transaction));
  }

  logger.info({ userId, transactionId: transaction._id.toString() }, "Transaction created");
  return { kind: "single", transaction };
}

async function invalidateStatsCacheSingle(userId: string, date: Date) {
  await invalidateStatsCache(userId, date);
}

// Shared with PATCH /api/transactions/[id] (browser) and the integration
// route — same field set, same linked-record guard.
export async function updateTransaction(input: UpdateTransactionInput) {
  const { userId, transactionId, actor, ...rest } = input;
  await connectDB();

  const existing = await Transaction.findOne({
    _id: transactionId,
    user: userId,
    isDeleted: { $ne: true },
  }).lean<{ date: Date; tags?: unknown[] }>();
  if (!existing) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  const blocker = await getLinkedTransactionBlocker(userId, transactionId, existing.tags);
  if (blocker) {
    throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to change it.`);
  }

  const update: Record<string, unknown> = { ...rest };
  // The server's own link tags stay on the row whatever the caller sends.
  if (rest.tags) update.tags = mergeUserTags(existing.tags, rest.tags);
  if (rest.date) update.date = new Date(rest.date);

  const transaction = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true } },
    { $set: update },
    { new: true }
  ).lean();
  if (!transaction) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }

  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transactionId,
    action: "update",
    before: existing,
    after: transaction,
    actor,
  });
  if (existing.date) await invalidateStatsCacheSingle(userId, new Date(existing.date));
  if (rest.date) await invalidateStatsCacheSingle(userId, new Date(rest.date));

  return transaction;
}

export type UserTagOutcome = "changed" | "unchanged" | "blocked" | "full" | "not_found" | "conflict";

/**
 * Adds ONE user tag to a live row, the way an edit would: refused for a row linked to a credit statement
 * payment or a loan repayment ("blocked"), kept within the tag cap ("full"), and written to the ledger.
 * Atomic ($addToSet with the cap in the filter), so it cannot undo a concurrent edit of the other tags.
 * "changed" means this call wrote the tag; "unchanged" means the row already had it (two calls at once
 * both end well: the second sees "unchanged"). When the row changes between the read and the write the
 * whole check is redone (3 tries), then "conflict". Used by anomaly alerts to tag a reported expense.
 */
export async function addUserTag(
  userId: string,
  transactionId: string,
  tag: string,
  actor: AuthUser
): Promise<UserTagOutcome> {
  await connectDB();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).lean<{
      date: Date;
      tags?: unknown[];
    }>();
    if (!before) return "not_found";
    if (await getLinkedTransactionBlocker(userId, transactionId, before.tags)) return "blocked";
    if ((before.tags ?? []).includes(tag)) return "unchanged";
    if ((before.tags ?? []).length >= MAX_TAGS) return "full";

    const after = await Transaction.findOneAndUpdate(
      { _id: transactionId, user: userId, isDeleted: { $ne: true }, tags: { $ne: tag }, [`tags.${MAX_TAGS - 1}`]: { $exists: false } },
      { $addToSet: { tags: tag } },
      { new: true }
    ).lean();
    if (!after) continue; // the row changed under us: read it again and decide again
    await appendLedgerBlock({ userId, scope: "transaction", entityId: transactionId, action: "update", before, after, actor });
    return "changed";
  }
  return "conflict";
}

// Shared with DELETE /api/transactions/[id] (browser) and the integration
// route — same balance-reversal logic (transfer-aware), same linked-record guard.
export async function deleteTransaction(userId: string, transactionId: string, actor: AuthUser) {
  await connectDB();

  const txn = await Transaction.findOne({ _id: transactionId, user: userId, isDeleted: { $ne: true } }).lean<{
    account: { toString(): string };
    transferTo?: { toString(): string };
    type: string;
    amount: number;
    date: Date;
    tags?: unknown[];
    recurringId?: unknown;
    installmentStatus?: string;
    balanceApplied?: boolean;
  }>();
  if (!txn) {
    throw new TransactionServiceError("TRANSACTION_NOT_FOUND", "Transaction not found");
  }
  const blocker = await getLinkedTransactionBlocker(userId, transactionId, txn.tags);
  if (blocker) {
    throw new TransactionServiceError("TRANSACTION_LOCKED", `${blocker} Use the linked record flow to reverse it.`);
  }

  // Reverse account balance only for transactions that previously affected it (a row written with
  // balanceApplied: false never moved it).
  const affectsBalance = txn.balanceApplied !== false && (!txn.recurringId || txn.installmentStatus === "paid");
  if (affectsBalance) {
    if (txn.type === "transfer") {
      const accountBefore = await Account.findOne({ _id: txn.account, user: userId });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: txn.account, user: userId },
        { $inc: { balance: txn.amount } },
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
      if (txn.transferTo) {
        const transferBefore = await Account.findOne({ _id: txn.transferTo, user: userId });
        const transferAfter = await Account.findOneAndUpdate(
          { _id: txn.transferTo, user: userId },
          { $inc: { balance: -txn.amount } },
          { new: true }
        );
        if (transferBefore && transferAfter) {
          await appendLedgerBlock({
            userId,
            scope: "account",
            entityId: transferAfter._id.toString(),
            action: "update",
            before: transferBefore,
            after: transferAfter,
            actor,
          });
        }
      }
    } else {
      const balanceDelta = txn.type === "income" ? -txn.amount : txn.amount;
      const accountBefore = await Account.findOne({ _id: txn.account, user: userId });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: txn.account, user: userId },
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
    }
  }

  const deleted = await Transaction.findOneAndUpdate(
    { _id: transactionId, user: userId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: transactionId,
    action: "delete",
    before: txn,
    after: deleted,
    actor,
  });
  await invalidateStatsCacheSingle(userId, new Date(txn.date));
  // A receipt is private and has no meaning without its transaction. Done last: a failure here is
  // logged and swept later (reads already hide receipts of a deleted row), never undoes the delete.
  await deleteReceiptsOfTransaction(userId, transactionId);
  // An open alert about a removed or voided expense goes quiet (voiding runs through here).
  await retireAnomaliesForTransactions(userId, [transactionId]);

  return deleted;
}

const installmentStatusSchema = z.enum(["paid", "skipped", "upcoming", "overdue"]);
export type InstallmentStatus = z.infer<typeof installmentStatusSchema>;

// Shared with PATCH /api/transactions/recurring/[recurringId]/installments/[id]
// (browser) and the integration route.
export async function setInstallmentStatus(
  userId: string,
  recurringId: string,
  installmentId: string,
  status: InstallmentStatus,
  actor: AuthUser
) {
  await connectDB();

  const installment = await Transaction.findOne({
    _id: installmentId,
    user: userId,
    isDeleted: { $ne: true },
    recurringId: new Types.ObjectId(recurringId),
  });
  if (!installment) {
    throw new TransactionServiceError("INSTALLMENT_NOT_FOUND", "Installment not found");
  }

  const installmentBefore = installment.toObject();
  const prevStatus = installment.installmentStatus;
  const previousPaidAt = installment.paidAt ? new Date(installment.paidAt) : undefined;
  const now = new Date();
  const installmentDate = new Date(installment.date);

  // Apply balance delta when marking paid — all installments, regardless of date
  if (status === "paid" && prevStatus !== "paid") {
    const delta = installment.type === "income" ? installment.amount : -installment.amount;
    const accountBefore = await Account.findOne({ _id: installment.account, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: installment.account, user: userId },
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

  // Reverse balance if un-paying
  if (prevStatus === "paid" && status !== "paid") {
    const delta = installment.type === "income" ? -installment.amount : installment.amount;
    const accountBefore = await Account.findOne({ _id: installment.account, user: userId });
    const accountAfter = await Account.findOneAndUpdate(
      { _id: installment.account, user: userId },
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

  installment.installmentStatus = status;
  installment.paidAt = status === "paid" ? now : undefined;
  await installment.save();
  await appendLedgerBlock({
    userId,
    scope: "transaction",
    entityId: installment._id.toString(),
    action: "update",
    before: installmentBefore,
    after: installment,
    actor,
  });

  if (status === "paid" && prevStatus !== "paid" && installment.type === "expense") {
    void checkBudgetAlert(userId, installment.category, installment.amount, now);
  }

  try {
    const cacheDates = [installmentDate, now, previousPaidAt].filter((item): item is Date => Boolean(item));
    await Promise.all(
      cacheDates.map((date) => invalidateStatsCacheSingle(userId, date))
    );
  } catch {
    // ignore
  }

  return installment;
}
