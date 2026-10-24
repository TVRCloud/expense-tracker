import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { isSupportedCurrency } from "@/lib/currency";
import { accountCreateSchema, creditMetaSchema } from "@/features/accounts/schemas/account.schema";
import { lockBaseCurrency } from "@/lib/base-currency";

export { accountCreateSchema };

export class AccountServiceError extends Error {
  code: "ACCOUNT_NOT_FOUND";
  constructor(code: "ACCOUNT_NOT_FOUND", message: string) {
    super(message);
    this.code = code;
    this.name = "AccountServiceError";
  }
}

export type CreateAccountInput = z.infer<typeof accountCreateSchema> & { userId: string; actor: AuthUser };

// Shared with POST /api/accounts (browser) and the integration route. `balance`
// is the opening balance; after this it only changes through transactions.
export async function createAccount(input: CreateAccountInput) {
  const { userId, actor, ...rest } = input;
  await connectDB();
  // An opening balance and a credit limit are base-unit amounts; an empty account is not.
  if (rest.balance !== 0 || (rest.creditMeta?.creditLimit ?? 0) > 0) await lockBaseCurrency(userId);
  const account = await Account.create({ ...rest, user: userId });
  await appendLedgerBlock({
    userId,
    scope: "account",
    entityId: account._id.toString(),
    action: "create",
    after: account,
    actor,
  });
  return account;
}

// No `balance` here on purpose: a direct balance edit would desync the ledger.
export const accountUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // The account's own currency, a label: balances stay in the base currency.
  currency: z.string().refine(isSupportedCurrency, "Unsupported currency").optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  isArchived: z.boolean().optional(),
  // Cash accounts: balance (cents) under which the app shows "low cash". null clears it.
  lowBalanceAt: z.number().int().min(0).nullable().optional(),
  creditMeta: creditMetaSchema.optional(),
  // Last 4 digits as they appear in bank SMS ("A/c XX1234"), for matching
  // captured messages to this account.
  smsLastFour: z.array(z.string().regex(/^\d{4}$/)).max(10).optional(),
});

export type UpdateAccountInput = z.infer<typeof accountUpdateSchema> & { userId: string; accountId: string; actor: AuthUser };

// Shared with PATCH /api/accounts/[id] and the integration route.
export async function updateAccount(input: UpdateAccountInput) {
  const { userId, accountId, actor, ...changes } = input;
  await connectDB();

  const filter = { _id: accountId, user: userId };
  const before = await Account.findOne(filter).lean();
  if (!before) throw new AccountServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  // A low-cash line or a credit limit is a base-unit amount. The lock comes
  // after the account lookup; the only write it can precede that then fails is
  // the update below losing the account to a concurrent archive or delete, a
  // window of one query, and the base stays locked in that case.
  if (typeof changes.lowBalanceAt === "number" || (changes.creditMeta?.creditLimit ?? 0) > 0) {
    await lockBaseCurrency(userId);
  }
  const account = await Account.findOneAndUpdate(filter, { $set: changes }, { new: true }).lean();
  if (!account) throw new AccountServiceError("ACCOUNT_NOT_FOUND", "Account not found");

  await appendLedgerBlock({ userId, scope: "account", entityId: accountId, action: "update", before, after: account, actor });
  return account;
}

// Archive (soft delete), shared with DELETE /api/accounts/[id] and the integration route.
export async function archiveAccount(userId: string, accountId: string, actor: AuthUser) {
  await connectDB();

  const filter = { _id: accountId, user: userId, isArchived: false };
  const before = await Account.findOne(filter).lean();
  if (!before) throw new AccountServiceError("ACCOUNT_NOT_FOUND", "Account not found");
  const account = await Account.findOneAndUpdate(
    filter,
    { $set: { isArchived: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  if (!account) throw new AccountServiceError("ACCOUNT_NOT_FOUND", "Account not found");

  await appendLedgerBlock({ userId, scope: "account", entityId: accountId, action: "delete", before, after: account, actor });
}

/** The user's cash account: the oldest live one of type "cash", or null. */
export async function findCashAccount(userId: string) {
  await connectDB();
  return Account.findOne({ user: userId, type: "cash", isArchived: { $ne: true } })
    .sort({ createdAt: 1 })
    .lean<{ _id: { toString(): string }; name: string; balance: number; currency: string; lowBalanceAt?: number | null } | null>();
}
