import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { accountCreateSchema, creditMetaSchema } from "@/features/accounts/schemas/account.schema";

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
  color: z.string().optional(),
  icon: z.string().optional(),
  isArchived: z.boolean().optional(),
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
