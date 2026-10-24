import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Transaction from "@/models/Transaction";
import { isSupportedCurrency } from "@/lib/currency";

// The base currency is `preferences.currency` (what the web app already uses
// to format every amount). All stored `amount` values are paise of it, so it
// cannot change once the user has transactions.

export class BaseCurrencyError extends Error {
  code: "UNSUPPORTED_CURRENCY" | "HAS_TRANSACTIONS";
  constructor(code: BaseCurrencyError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "BaseCurrencyError";
  }
}

export async function getBaseCurrency(userId: string): Promise<string> {
  await connectDB();
  const user = await User.findById(userId)
    .select("currency preferences.currency")
    .lean<{ currency?: string; preferences?: { currency?: string } } | null>();
  const code = user?.preferences?.currency ?? user?.currency ?? "INR";
  return isSupportedCurrency(code) ? code : "INR";
}

/** Sets the base currency. Refused once any transaction (even a deleted one) exists, unless it is the same code. */
export async function setBaseCurrency(userId: string, code: string): Promise<string> {
  if (!isSupportedCurrency(code)) {
    throw new BaseCurrencyError("UNSUPPORTED_CURRENCY", "Currency is not supported");
  }
  const current = await getBaseCurrency(userId);
  if (current === code) return code;
  if (await Transaction.exists({ user: userId })) {
    throw new BaseCurrencyError(
      "HAS_TRANSACTIONS",
      "The base currency is fixed once you have transactions, because every stored amount is in it."
    );
  }
  await User.updateOne({ _id: userId }, { $set: { "preferences.currency": code } });
  return code;
}
