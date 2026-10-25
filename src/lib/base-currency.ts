import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import Budget from "@/models/Budget";
import Goal from "@/models/Goal";
import Loan from "@/models/Loan";
import SinkingFund from "@/models/SinkingFund";
import ManualAsset from "@/models/ManualAsset";
import SpendLimit from "@/models/SpendLimit";
import EnvelopePlan from "@/models/EnvelopePlan";
import { BASE_CURRENCY_ONLY_TWO_DECIMALS, isSupportedAsBase, isSupportedCurrency, type CurrencyCode } from "@/lib/currency";

// The base currency is `preferences.currency` (what the web app already uses
// to format every amount). Every stored amount (transactions, balances,
// budgets, goals, loans, funds, assets, limits) is in minor units of it, so it
// must not change once any of them exists.
//
// The guard is a flag on the user document, `baseLocked`:
//  - lockBaseCurrency() sets it atomically and returns the base in force at
//    that moment. Every writer of a base-unit amount calls it BEFORE the insert.
//  - setBaseCurrency() changes the base with a single conditional update that
//    only matches while the flag is absent, so a write that locked first wins
//    and a write that comes after sees the new base.
//  - Accounts that had data before the flag existed are locked lazily: the
//    first setBaseCurrency finds the rows, sets the flag and refuses.

export class BaseCurrencyError extends Error {
  code: "UNSUPPORTED_CURRENCY" | "UNSUPPORTED_BASE_CURRENCY" | "HAS_MONEY_DATA";
  constructor(code: BaseCurrencyError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "BaseCurrencyError";
  }
}

type PrefsDoc = { currency?: string; preferences?: { currency?: string } } | null;

function baseOf(user: PrefsDoc): CurrencyCode {
  const code = user?.preferences?.currency ?? user?.currency ?? "INR";
  return isSupportedCurrency(code) ? code : "INR";
}

export async function getBaseCurrency(userId: string): Promise<CurrencyCode> {
  return (await getBaseState(userId)).base;
}

export type BaseState = { base: CurrencyCode; locked: boolean };

/** The base currency and whether it is already locked, in one read. */
export async function getBaseState(userId: string): Promise<BaseState> {
  await connectDB();
  const user = await User.findById(userId)
    .select("currency preferences.currency baseLocked")
    .lean<(PrefsDoc & { baseLocked?: boolean }) | null>();
  return { base: baseOf(user), locked: Boolean(user?.baseLocked) };
}

/**
 * Locks the base currency for this user (atomic) and returns the base in force
 * at that moment. Call it right before writing an amount in base units, after
 * every check that can reject the write, so a rejected write does not lock.
 * The one exception is a base change that lands between the caller's read and
 * this lock: the caller then redoes its work against the new base, and that
 * redo can still be rejected (say, no rate). The lock stays on in that case.
 * Pass the state you read earlier: once it was locked nothing is written, so a
 * busy user costs no extra User write.
 */
export async function lockBaseCurrency(userId: string, known?: BaseState): Promise<CurrencyCode> {
  if (known?.locked) return known.base;
  await connectDB();
  const user = await User.findOneAndUpdate(
    { _id: userId },
    { $set: { baseLocked: true } },
    { projection: { currency: 1, "preferences.currency": 1 } }
  ).lean<PrefsDoc>();
  return baseOf(user);
}

/** True when the user has any row whose amounts are in base units. */
export async function hasMoneyData(userId: string): Promise<boolean> {
  const mine = { user: userId };
  const found = await Promise.all([
    Transaction.exists(mine),
    Account.exists({ ...mine, balance: { $ne: 0 } }),
    Account.exists({ ...mine, "creditMeta.creditLimit": { $gt: 0 } }),
    Account.exists({ ...mine, lowBalanceAt: { $ne: null } }),
    Budget.exists(mine),
    Goal.exists(mine),
    Loan.exists(mine),
    SinkingFund.exists(mine),
    ManualAsset.exists(mine),
    SpendLimit.exists({ ...mine, $or: [{ dailyAmount: { $gt: 0 } }, { weeklyAmount: { $gt: 0 } }] }),
    EnvelopePlan.exists({ ...mine, $or: [{ income: { $gt: 0 } }, { "envelopes.assigned": { $gt: 0 } }] }),
  ]);
  return found.some(Boolean);
}

const REFUSED =
  "The base currency is fixed once you have transactions, balances, credit limits, budgets, goals, loans, funds, assets, envelope plans or a spend limit, because every stored amount is in it.";

/** Sets the base currency. Refused once any money row exists or the user is locked, unless it is the same code. */
export async function setBaseCurrency(userId: string, code: string): Promise<string> {
  if (!isSupportedCurrency(code)) {
    throw new BaseCurrencyError("UNSUPPORTED_CURRENCY", "Currency is not supported");
  }
  await connectDB();
  const user = await User.findById(userId)
    .select("currency preferences.currency baseLocked")
    .lean<(PrefsDoc & { baseLocked?: boolean }) | null>();
  if (baseOf(user) === code) return code;
  if (!isSupportedAsBase(code)) {
    throw new BaseCurrencyError("UNSUPPORTED_BASE_CURRENCY", BASE_CURRENCY_ONLY_TWO_DECIMALS);
  }
  if (user?.baseLocked) throw new BaseCurrencyError("HAS_MONEY_DATA", REFUSED);

  if (await hasMoneyData(userId)) {
    await User.updateOne({ _id: userId }, { $set: { baseLocked: true } });
    throw new BaseCurrencyError("HAS_MONEY_DATA", REFUSED);
  }
  // Matches only while nothing has locked the base since the check above.
  const res = await User.updateOne(
    { _id: userId, baseLocked: { $ne: true } },
    { $set: { "preferences.currency": code } }
  );
  if (res.matchedCount === 0) throw new BaseCurrencyError("HAS_MONEY_DATA", REFUSED);
  return code;
}
