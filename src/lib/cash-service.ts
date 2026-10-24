import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import type { AuthUser } from "@/lib/auth-guard";
import { createAccount, findCashAccount, updateAccount } from "@/lib/account-service";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";
import { getBaseCurrency } from "@/lib/base-currency";

// The user's cash: the account that ATM withdrawals move money into and cash
// spends come out of. One cash account per user is "the" cash account (the
// oldest live account of type "cash"); this file reads its numbers for a
// low-cash view and sets it up on demand. Withdrawals themselves are ordinary
// transfers (transfer-service) or captured ATM messages (capture/ingest.ts).

/** Low-cash line when the user has not set one: Rs 500, in paise. */
export const DEFAULT_LOW_CASH = 50_000;
const WINDOW_DAYS = 30;
const RECENT = 5;

export const cashSetupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Only used when the cash account is created now.
  openingBalance: z.number().int().min(-MAX_MINOR_AMOUNT).max(MAX_MINOR_AMOUNT).optional(),
  // paise; null puts the default back.
  lowBalanceAt: z.number().int().min(0).nullable().optional(),
});

export type CashSetupInput = z.infer<typeof cashSetupSchema> & { userId: string; actor: AuthUser };

export type CashSummary = {
  account: { id: string; name: string; balance: number; currency: string; lowBalanceAt: number | null } | null;
  lowBalanceAt: number;
  lowBalanceIsDefault: boolean;
  isLow: boolean;
  last30Days: { withdrawn: number; withdrawals: number; spent: number };
  recentWithdrawals: { id: string; amount: number; date: Date; fromAccountId: string; description: string | null }[];
};

const EMPTY: CashSummary = {
  account: null,
  lowBalanceAt: DEFAULT_LOW_CASH,
  lowBalanceIsDefault: true,
  isLow: false,
  last30Days: { withdrawn: 0, withdrawals: 0, spent: 0 },
  recentWithdrawals: [],
};

export async function getCashSummary(userId: string, now = new Date()): Promise<CashSummary> {
  await connectDB();
  const cash = await findCashAccount(userId);
  if (!cash) return EMPTY;

  const baseCurrency = await getBaseCurrency(userId);
  const cashId = new Types.ObjectId(cash._id.toString());
  const user = new Types.ObjectId(userId);
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const live = { user, isDeleted: { $ne: true }, date: { $gte: since, $lte: now } };

  const [withdrawn, spent, recent] = await Promise.all([
    Transaction.aggregate<{ total: number; count: number }>([
      { $match: { ...live, type: "transfer", transferTo: cashId } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate<{ total: number }>([
      { $match: { ...live, type: "expense", account: cashId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Transaction.find({ user, type: "transfer", transferTo: cashId, isDeleted: { $ne: true } })
      .sort({ date: -1 })
      .limit(RECENT)
      .select("_id amount date account description")
      .lean<{ _id: { toString(): string }; amount: number; date: Date; account: { toString(): string }; description?: string }[]>(),
  ]);

  const setLine = typeof cash.lowBalanceAt === "number" ? cash.lowBalanceAt : null;
  const line = setLine ?? DEFAULT_LOW_CASH;
  return {
    account: {
      id: cash._id.toString(),
      name: cash.name,
      balance: cash.balance,
      currency: baseCurrency,
      lowBalanceAt: setLine,
    },
    lowBalanceAt: line,
    lowBalanceIsDefault: setLine === null,
    isLow: cash.balance <= line,
    last30Days: { withdrawn: withdrawn[0]?.total ?? 0, withdrawals: withdrawn[0]?.count ?? 0, spent: spent[0]?.total ?? 0 },
    recentWithdrawals: recent.map((t) => ({
      id: t._id.toString(),
      amount: t.amount,
      date: t.date,
      fromAccountId: t.account.toString(),
      description: t.description ?? null,
    })),
  };
}

/**
 * Makes sure the user has a cash account and applies what was asked. Returns
 * the summary and whether the account was created by this call.
 */
export async function setupCash(input: CashSetupInput): Promise<{ summary: CashSummary; created: boolean }> {
  const { userId, actor, name, openingBalance, lowBalanceAt } = input;
  await connectDB();

  const existing = await findCashAccount(userId);
  if (!existing) {
    const account = await createAccount({
      userId,
      actor,
      name: name ?? "Cash",
      type: "cash",
      balance: openingBalance ?? 0,
      currency: await getBaseCurrency(userId),
    });
    if (typeof lowBalanceAt === "number") {
      await updateAccount({ userId, accountId: account._id.toString(), actor, lowBalanceAt });
    }
    return { summary: await getCashSummary(userId), created: true };
  }

  const changes: { name?: string; lowBalanceAt?: number | null } = {};
  if (name && name !== existing.name) changes.name = name;
  if (lowBalanceAt !== undefined) changes.lowBalanceAt = lowBalanceAt;
  if (Object.keys(changes).length > 0) {
    await updateAccount({ userId, accountId: existing._id.toString(), actor, ...changes });
  }
  return { summary: await getCashSummary(userId), created: false };
}
