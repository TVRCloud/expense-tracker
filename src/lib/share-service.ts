import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import { runInBackground } from "@/lib/perf/background";
import Share from "@/models/Share";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
import Notification from "@/models/Notification";
import type { AuthUser } from "@/lib/auth-guard";
import { checkSecurityRateLimit } from "@/lib/security-rate-limit";
import { listBudgetsWithSpend } from "@/lib/budget-service";
import { getBaseCurrency } from "@/lib/base-currency";
import { activityDateAddFields } from "@/lib/transaction-activity";
import { DEFAULT_TIME_ZONE, isValidTimeZone, localDate, localMidnight } from "@/lib/spend-limit-time";
import { createTransaction, TransactionServiceError } from "@/lib/transaction-service";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";

// Household sharing. An owner shares chosen accounts (and optionally budgets)
// with one other person as a viewer or an editor. Nothing here changes how any
// existing query is scoped: every current route still filters by `user`. The
// `shared` routes call `loadActiveShare` first and answer 404 when it finds
// nothing, so a revoked, pending, expired, declined or never-existing share
// look the same. Design and threat model: docs/household.md.

export const MAX_LIVE_SHARES_PER_OWNER = 10;
export const MAX_SHARES_PER_ACCOUNT = 5;
export const MAX_SHARED_ACCOUNTS = 20;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ENDED_SHARE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_SHARED_PAGE = 50;
export const MAX_SHARED_SKIP = 10_000;
// Wrong or guessed codes: ten tries per person in ten minutes.
const ACCEPT_ATTEMPTS = 10;
const ACCEPT_WINDOW_MS = 10 * 60 * 1000;

const LIVE = ["pending", "active"] as const;

export type ShareErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "LIMIT_REACHED"
  | "ALREADY_SHARED"
  | "FORBIDDEN_ROLE"
  | "RATE_LIMITED";

export class ShareServiceError extends Error {
  code: ShareErrorCode;
  retryAfterSeconds?: number;
  constructor(code: ShareErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.name = "ShareServiceError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v) && /^[0-9a-f]{24}$/i.test(v), "Invalid id");

export const shareInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  accountIds: z.array(objectId).min(1).max(MAX_SHARED_ACCOUNTS),
  role: z.enum(["viewer", "editor"]).default("viewer"),
  includeBudgets: z.boolean().default(false),
});
export type ShareInviteInput = z.infer<typeof shareInviteSchema>;

export const shareUpdateSchema = z
  .object({
    accountIds: z.array(objectId).min(1).max(MAX_SHARED_ACCOUNTS).optional(),
    role: z.enum(["viewer", "editor"]).optional(),
    includeBudgets: z.boolean().optional(),
  })
  .refine((v) => v.accountIds !== undefined || v.role !== undefined || v.includeBudgets !== undefined, "Nothing to change");
export type ShareUpdateInput = z.infer<typeof shareUpdateSchema>;

export const shareAcceptSchema = z.object({ token: z.string().min(20).max(200) });

// An editor adds one plain income or expense. Strict: tags, splits, recurrence,
// transfers and foreign amounts are a 400, not silently dropped.
export const sharedTransactionSchema = z
  .object({
    accountId: objectId,
    type: z.enum(["income", "expense"]),
    amount: z.number().int().positive().max(MAX_MINOR_AMOUNT),
    category: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
    date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
  })
  .strict();
export type SharedTransactionInput = z.infer<typeof sharedTransactionSchema>;

type ShareDoc = {
  _id: Types.ObjectId;
  owner: Types.ObjectId;
  member?: Types.ObjectId | null;
  memberEmail: string;
  accountIds: Types.ObjectId[];
  includeBudgets: boolean;
  role: "viewer" | "editor";
  status: "pending" | "active" | "revoked" | "declined";
  inviteExpiresAt?: Date;
  acceptedAt?: Date;
  createdAt: Date;
};

type UserBrief = { _id: Types.ObjectId; name?: string; email?: string };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

const idStr = (v: { toString(): string }) => v.toString();

async function notify(userId: string, title: string, body: string, meta: Record<string, unknown>) {
  try {
    await connectDB();
    await Notification.create({ user: userId, type: "system", title, body, meta });
  } catch (err) {
    // A missed notice never fails the action it reports.
    logger.error({ err, userId }, "household notification failed");
  }
}

function endUpdate(endedBy: "owner" | "member" | "account_deleted", status: "revoked" | "declined") {
  return {
    $set: { status, endedAt: new Date(), endedBy, cleanupAt: new Date(Date.now() + ENDED_SHARE_KEEP_MS) },
    $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 },
  };
}

/** Pending invites past their expiry are ended, so they free the owner's slot and the unique index. */
async function expireInvites(ownerId: string) {
  const now = new Date();
  await Share.updateMany(
    { owner: ownerId, status: "pending", inviteExpiresAt: { $lte: now } },
    endUpdate("owner", "revoked")
  );
}

async function checkOwnedAccounts(ownerId: string, accountIds: string[]) {
  const unique = [...new Set(accountIds)];
  if (unique.length !== accountIds.length) throw new ShareServiceError("VALIDATION", "Each account can be listed once");
  const found = await Account.countDocuments({
    _id: { $in: unique },
    user: ownerId,
    isArchived: { $ne: true },
    deletedAt: null,
  });
  // Someone else's, archived and unknown accounts all read the same.
  if (found !== unique.length) throw new ShareServiceError("VALIDATION", "Choose accounts you own that are not archived");
  return unique;
}

async function checkAccountLimits(accountIds: string[], exceptShareId?: string) {
  const ids = accountIds.map((id) => new Types.ObjectId(id));
  const rows = await Share.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        status: { $in: [...LIVE] },
        accountIds: { $in: ids },
        ...(exceptShareId ? { _id: { $ne: new Types.ObjectId(exceptShareId) } } : {}),
      },
    },
    { $unwind: "$accountIds" },
    { $match: { accountIds: { $in: ids } } },
    { $group: { _id: "$accountIds", n: { $sum: 1 } } },
  ]);
  if (rows.some((r) => r.n >= MAX_SHARES_PER_ACCOUNT)) {
    throw new ShareServiceError("LIMIT_REACHED", `An account can be shared with at most ${MAX_SHARES_PER_ACCOUNT} people`);
  }
}

/** Runs an undo step, once more if it fails; a second failure is logged loudly and never hides the caller's own error. */
async function undoWithRetry(what: string, step: () => Promise<unknown>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await step();
      return;
    } catch (err) {
      if (attempt === 1) logger.error({ err, what }, "household undo failed; a share may exceed its limit until cleaned up");
    }
  }
}

/** True when the live shares of this owner, or of any of these accounts, are over the limits. */
async function overLimits(ownerId: string, accountIds: string[]) {
  const live = await Share.countDocuments({ owner: ownerId, status: { $in: [...LIVE] } });
  if (live > MAX_LIVE_SHARES_PER_OWNER) return true;
  const ids = accountIds.map((id) => new Types.ObjectId(id));
  const rows = await Share.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: { $in: [...LIVE] }, accountIds: { $in: ids } } },
    { $unwind: "$accountIds" },
    { $match: { accountIds: { $in: ids } } },
    { $group: { _id: "$accountIds", n: { $sum: 1 } } },
  ]);
  return rows.some((r) => r.n > MAX_SHARES_PER_ACCOUNT);
}

// ── Views ──────────────────────────────────────────────────────────────────

function ownerView(s: ShareDoc, member?: UserBrief) {
  const expired = s.status === "pending" && s.inviteExpiresAt !== undefined && s.inviteExpiresAt.getTime() <= Date.now();
  return {
    id: idStr(s._id),
    status: expired ? ("expired" as const) : s.status,
    role: s.role,
    includeBudgets: s.includeBudgets,
    accountIds: s.accountIds.map(idStr),
    member: { email: s.memberEmail, name: member?.name ?? null },
    inviteExpiresAt: s.status === "pending" ? (s.inviteExpiresAt ?? null) : null,
    acceptedAt: s.acceptedAt ?? null,
    createdAt: s.createdAt,
  };
}

function memberView(s: ShareDoc, owner?: UserBrief) {
  const active = s.status === "active";
  return {
    id: idStr(s._id),
    status: s.status,
    role: s.role,
    includeBudgets: s.includeBudgets,
    owner: { id: idStr(s.owner), name: owner?.name ?? null },
    // A pending invite shows how many accounts, not which ones.
    accountCount: s.accountIds.length,
    accountIds: active ? s.accountIds.map(idStr) : [],
    inviteExpiresAt: s.status === "pending" ? (s.inviteExpiresAt ?? null) : null,
    acceptedAt: s.acceptedAt ?? null,
    createdAt: s.createdAt,
  };
}

export type OwnerShareView = ReturnType<typeof ownerView>;
export type MemberShareView = ReturnType<typeof memberView>;

// ── Owner: invite, list, edit, revoke ─────────────────────────────────────

export async function createInvite(owner: { id: string; name: string; email: string }, input: ShareInviteInput) {
  await connectDB();
  if (input.email === owner.email.toLowerCase()) {
    throw new ShareServiceError("VALIDATION", "You cannot share with yourself");
  }
  const accountIds = await checkOwnedAccounts(owner.id, input.accountIds);
  await expireInvites(owner.id);
  const live = await Share.countDocuments({ owner: owner.id, status: { $in: [...LIVE] } });
  if (live >= MAX_LIVE_SHARES_PER_OWNER) {
    throw new ShareServiceError("LIMIT_REACHED", `You can have at most ${MAX_LIVE_SHARES_PER_OWNER} shares at a time`);
  }
  await checkAccountLimits(accountIds);

  const token = newToken();
  let share: ShareDoc;
  try {
    share = (await Share.create({
      owner: owner.id,
      memberEmail: input.email,
      accountIds,
      includeBudgets: input.includeBudgets,
      role: input.role,
      status: "pending",
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })).toObject() as ShareDoc;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new ShareServiceError("ALREADY_SHARED", "You already share with that address. Change or end that share first.");
    }
    throw err;
  }

  // The counts above and the insert are separate steps, so two invites sent at the same moment can
  // both pass. Count again now that this one exists; if the limit is passed, take this one back.
  // (If both are over, both go: the owner retries. The limit is never exceeded for good.)
  // If the check itself fails, the new invite is taken back too: never keep one that was not checked.
  let over: boolean;
  try {
    over = await overLimits(owner.id, accountIds);
  } catch (err) {
    await undoWithRetry("take back an unchecked invite", () => Share.deleteOne({ _id: share._id, status: "pending" }));
    throw err;
  }
  if (over) {
    await undoWithRetry("take back an over-limit invite", () => Share.deleteOne({ _id: share._id, status: "pending" }));
    throw new ShareServiceError("LIMIT_REACHED", "Sharing limit reached. Try again.");
  }

  // A registered invitee is told in the app; the code itself only goes to the owner. Looked up and
  // sent after the answer, so a registered and an unregistered address take the same time to answer.
  const shareId = idStr(share._id);
  const accountCount = accountIds.length;
  runInBackground("household.inviteNotice", async () => {
    const invitee = await User.findOne({ email: input.email, isActive: true }).select("_id").lean<{ _id: Types.ObjectId }>();
    if (!invitee) return;
    await notify(
      idStr(invitee._id),
      "Household invite",
      `${owner.name || "Someone"} invited you to share ${accountCount === 1 ? "an account" : `${accountCount} accounts`}. Ask them for the code to accept.`,
      { kind: "household_invite", shareId }
    );
  });
  logger.info({ ownerId: owner.id, shareId: idStr(share._id), role: input.role }, "household invite created");
  return { share: ownerView(share), token };
}

/**
 * A fresh invite code for a pending invite (the first one was lost), valid for
 * another 7 days. The old code stops working at once. Only the new code's hash is stored.
 */
export async function rotateInviteCode(ownerId: string, shareId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Share not found");
  const token = newToken();
  const share = await Share.findOneAndUpdate(
    { _id: shareId, owner: ownerId, status: "pending" },
    { $set: { inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) } },
    { new: true }
  ).lean<ShareDoc>();
  if (!share) throw new ShareServiceError("NOT_FOUND", "Share not found");
  return { share: ownerView(share), token };
}

export async function listShares(user: { id: string; email: string }) {
  await connectDB();
  await expireInvites(user.id);
  const now = new Date();
  const email = user.email.toLowerCase();
  const [owned, received] = await Promise.all([
    Share.find({ owner: user.id, status: { $in: [...LIVE] } }).sort({ createdAt: -1 }).limit(MAX_LIVE_SHARES_PER_OWNER * 2).lean<ShareDoc[]>(),
    Share.find({
      $or: [
        { member: user.id, status: "active" },
        { memberEmail: email, status: "pending", inviteExpiresAt: { $gt: now } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<ShareDoc[]>(),
  ]);

  // A member's name is looked up only through the `member` id of an ACTIVE share (they accepted).
  // A pending invite shows the typed address and no name, so the list cannot tell the owner
  // whether that address is registered, or whose it is.
  const memberKeys = owned.filter((s) => s.status === "active" && s.member).map((s) => s.member);
  const [members, owners] = await Promise.all([
    memberKeys.length
      ? User.find({ _id: { $in: memberKeys }, isActive: true }).select("name").lean<UserBrief[]>()
      : Promise.resolve([] as UserBrief[]),
    received.length
      ? User.find({ _id: { $in: received.map((s) => s.owner) } }).select("name").lean<UserBrief[]>()
      : Promise.resolve([] as UserBrief[]),
  ]);
  const memberById = new Map(members.map((u) => [idStr(u._id), u]));
  const ownerById = new Map(owners.map((u) => [idStr(u._id), u]));

  return {
    owned: owned.map((s) => ownerView(s, s.status === "active" && s.member ? memberById.get(idStr(s.member)) : undefined)),
    received: received.map((s) => memberView(s, ownerById.get(idStr(s.owner)))),
  };
}

export async function updateShare(ownerId: string, shareId: string, input: ShareUpdateInput) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Share not found");
  const existing = await Share.findOne({ _id: shareId, owner: ownerId, status: { $in: [...LIVE] } }).lean<ShareDoc>();
  if (!existing) throw new ShareServiceError("NOT_FOUND", "Share not found");

  const live = { _id: shareId, owner: ownerId, status: { $in: [...LIVE] } };
  const plain: Record<string, unknown> = {};
  if (input.role !== undefined) plain.role = input.role;
  if (input.includeBudgets !== undefined) plain.includeBudgets = input.includeBudgets;

  let updated: ShareDoc | null = null;
  if (input.accountIds !== undefined) {
    const accountIds = await checkOwnedAccounts(ownerId, input.accountIds);
    await checkAccountLimits(accountIds, shareId);
    // The accounts go first, alone. Role and budgets are applied only once the limit check passed,
    // so a refused change never leaves the member with more access than before.
    updated = await Share.findOneAndUpdate(live, { $set: { accountIds } }, { new: true }).lean<ShareDoc>();
    if (!updated) throw new ShareServiceError("NOT_FOUND", "Share not found");
    // Same race as an invite: count again after the change. If it is over, or the check fails, put the
    // previous accounts back, but only if they are still the ones this request wrote (a concurrent
    // change by the owner is not undone).
    const restore = () =>
      Share.updateOne({ ...live, accountIds }, { $set: { accountIds: existing.accountIds } });
    let over: boolean;
    try {
      over = await overLimits(ownerId, accountIds);
    } catch (err) {
      await undoWithRetry("restore share accounts", restore);
      throw err;
    }
    if (over) {
      await undoWithRetry("restore share accounts", restore);
      throw new ShareServiceError("LIMIT_REACHED", "Sharing limit reached. Try again.");
    }
  }
  if (Object.keys(plain).length > 0 || !updated) {
    updated = await Share.findOneAndUpdate(live, { $set: plain }, { new: true }).lean<ShareDoc>();
    if (!updated) throw new ShareServiceError("NOT_FOUND", "Share not found");
  }
  const member =
    updated.status === "active" && updated.member ? await User.findById(updated.member).select("name").lean<UserBrief>() : null;
  return ownerView(updated, member ?? undefined);
}

export async function revokeShare(ownerId: string, shareId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Share not found");
  const ended = await Share.findOneAndUpdate(
    { _id: shareId, owner: ownerId, status: { $in: [...LIVE] } },
    endUpdate("owner", "revoked"),
    { new: true }
  ).lean<ShareDoc>();
  if (!ended) throw new ShareServiceError("NOT_FOUND", "Share not found");
  const memberId = ended.member
    ? idStr(ended.member)
    : (await User.findOne({ email: ended.memberEmail, isActive: true }).select("_id").lean<{ _id: Types.ObjectId }>())?._id.toString();
  if (memberId) {
    await notify(memberId, "Household sharing ended", "An account owner stopped sharing with you.", {
      kind: "household_revoked",
      shareId: idStr(ended._id),
    });
  }
  logger.info({ ownerId, shareId }, "household share revoked");
  return { id: shareId, status: "revoked" as const };
}

// ── Member: accept, decline, leave ────────────────────────────────────────

export async function acceptInvite(user: { id: string; email: string; name: string }, shareId: string, token: string) {
  await connectDB();
  const limit = await checkSecurityRateLimit({ key: `share-accept:${user.id}`, limit: ACCEPT_ATTEMPTS, windowMs: ACCEPT_WINDOW_MS });
  if (!limit.allowed) {
    throw new ShareServiceError("RATE_LIMITED", "Too many tries. Wait a while and try again.", limit.retryAfterSeconds);
  }
  // Every miss below is the same answer: no such invite for you.
  const notFound = () => new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  if (!Types.ObjectId.isValid(shareId)) throw notFound();
  const email = user.email.toLowerCase();
  const now = new Date();
  const invite = await Share.findOne({
    _id: shareId,
    status: "pending",
    memberEmail: email,
    inviteExpiresAt: { $gt: now },
  }).lean<ShareDoc & { inviteTokenHash?: string }>();
  if (!invite || !invite.inviteTokenHash || !sameHash(invite.inviteTokenHash, hashToken(token))) throw notFound();
  if (idStr(invite.owner) === user.id) throw notFound();
  const owner = await User.findOne({ _id: invite.owner, isActive: true }).select("name").lean<UserBrief>();
  if (!owner) throw notFound();

  const accepted = await Share.findOneAndUpdate(
    { _id: shareId, status: "pending", memberEmail: email, inviteTokenHash: invite.inviteTokenHash, inviteExpiresAt: { $gt: now } },
    { $set: { status: "active", member: user.id, acceptedAt: now }, $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 } },
    { new: true }
  ).lean<ShareDoc>();
  // Lost a race with a second accept or a revoke: the code works once.
  if (!accepted) throw notFound();

  await notify(idStr(accepted.owner), "Household invite accepted", `${user.name || user.email} can now see the accounts you shared.`, {
    kind: "household_accepted",
    shareId: idStr(accepted._id),
  });
  logger.info({ ownerId: idStr(accepted.owner), memberId: user.id, shareId }, "household invite accepted");
  return memberView(accepted, owner);
}

/** The live answer for a replayed accept: the caller's own active share, or a 404 when it has ended since. */
export async function currentMemberShare(userId: string, shareId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  const share = await Share.findOne({ _id: shareId, member: userId, status: "active" }).lean<ShareDoc>();
  if (!share) throw new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  const owner = await User.findOne({ _id: share.owner, isActive: true }).select("name").lean<UserBrief>();
  if (!owner) throw new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  return memberView(share, owner);
}

export async function declineInvite(user: { id: string; email: string; name: string }, shareId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  const ended = await Share.findOneAndUpdate(
    { _id: shareId, status: "pending", memberEmail: user.email.toLowerCase(), inviteExpiresAt: { $gt: new Date() } },
    endUpdate("member", "declined"),
    { new: true }
  ).lean<ShareDoc>();
  if (!ended) throw new ShareServiceError("NOT_FOUND", "Invite not found or expired");
  await notify(idStr(ended.owner), "Household invite declined", `${user.name || user.email} declined your invite.`, {
    kind: "household_declined",
    shareId: idStr(ended._id),
  });
  return { id: shareId, status: "declined" as const };
}

export async function leaveShare(user: { id: string; name: string; email: string }, shareId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(shareId)) throw new ShareServiceError("NOT_FOUND", "Share not found");
  const ended = await Share.findOneAndUpdate(
    { _id: shareId, member: user.id, status: "active" },
    endUpdate("member", "revoked"),
    { new: true }
  ).lean<ShareDoc>();
  if (!ended) throw new ShareServiceError("NOT_FOUND", "Share not found");
  await notify(idStr(ended.owner), "Household member left", `${user.name || user.email} stopped viewing the accounts you shared.`, {
    kind: "household_left",
    shareId: idStr(ended._id),
  });
  logger.info({ ownerId: idStr(ended.owner), memberId: user.id, shareId }, "household share left");
  return { id: shareId, status: "revoked" as const };
}

/** Account deletion: every share the person owns or is a member of ends at once. */
export async function revokeAllSharesOfUser(userId: string, email?: string) {
  await connectDB();
  // Pending invites addressed to the person's email end too, or someone else who later registers
  // the freed address could accept them with a code the owner meant for the old account.
  const addressed = email ? [{ memberEmail: email.toLowerCase(), status: "pending" }] : [];
  const result = await Share.updateMany(
    { $or: [{ owner: userId }, { member: userId }, ...addressed], status: { $in: [...LIVE] } },
    endUpdate("account_deleted", "revoked")
  );
  return result.modifiedCount;
}

// ── Shared reads ──────────────────────────────────────────────────────────

export type ShareContext = {
  share: ShareDoc;
  ownerId: string;
  ownerName: string | null;
  timeZone: string;
  baseCurrency: string;
  /** The shared accounts that still exist, belong to the owner and are not archived. */
  accountIds: Types.ObjectId[];
  accounts: {
    _id: Types.ObjectId;
    name: string;
    type: string;
    balance: number;
    color?: string;
    icon?: string;
  }[];
};

/**
 * The one access check. Returns null (the caller answers 404) unless the caller
 * is the member of an ACTIVE share of this owner and the owner's account is
 * still active. Nothing is cached, so a revoke is effective on the next request.
 */
export async function loadActiveShare(memberId: string, ownerId: string): Promise<ShareContext | null> {
  if (!Types.ObjectId.isValid(memberId) || !Types.ObjectId.isValid(ownerId)) return null;
  await connectDB();
  const share = await Share.findOne({ owner: ownerId, member: memberId, status: "active" }).lean<ShareDoc>();
  if (!share) return null;
  const owner = await User.findOne({ _id: ownerId, isActive: true })
    .select("name preferences.timezone")
    .lean<{ name?: string; preferences?: { timezone?: string } }>();
  if (!owner) return null;
  const accounts = await Account.find({
    _id: { $in: share.accountIds },
    user: ownerId,
    isArchived: { $ne: true },
    deletedAt: null,
  })
    .select("name type balance color icon")
    .sort({ createdAt: 1 })
    .lean<ShareContext["accounts"]>();
  const tz = owner.preferences?.timezone;
  return {
    share,
    ownerId,
    ownerName: owner.name ?? null,
    timeZone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    baseCurrency: await getBaseCurrency(ownerId),
    accountIds: accounts.map((a) => a._id),
    accounts,
  };
}

export function sharedAccountsView(ctx: ShareContext) {
  return {
    owner: { id: ctx.ownerId, name: ctx.ownerName },
    role: ctx.share.role,
    includeBudgets: ctx.share.includeBudgets,
    currency: ctx.baseCurrency,
    accounts: ctx.accounts.map((a) => ({
      id: idStr(a._id),
      name: a.name,
      type: a.type,
      balance: a.balance,
      color: a.color ?? null,
      icon: a.icon ?? null,
    })),
  };
}

const UNPAID_RECURRING = { recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } };

export type SharedTransactionsParams = {
  skip: number;
  limit: number;
  accountId?: string | null;
  type?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export async function listSharedTransactions(ctx: ShareContext, p: SharedTransactionsParams) {
  const skip = Math.min(Math.max(Math.trunc(p.skip) || 0, 0), MAX_SHARED_SKIP);
  const limit = Math.min(Math.max(Math.trunc(p.limit) || 20, 1), MAX_SHARED_PAGE);
  const ids = ctx.accountIds;
  const allowed = new Set(ids.map(idStr));

  if (p.accountId && !allowed.has(p.accountId)) throw new ShareServiceError("NOT_FOUND", "Not found");
  if (p.type && !["income", "expense", "transfer"].includes(p.type)) throw new ShareServiceError("VALIDATION", "Invalid type");
  const range: Record<string, Date> = {};
  for (const [key, raw] of [["$gte", p.dateFrom], ["$lte", p.dateTo]] as const) {
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new ShareServiceError("VALIDATION", "Invalid date");
    range[key] = d;
  }

  const scope = p.accountId
    ? [{ account: new Types.ObjectId(p.accountId) }, { type: "transfer", transferTo: new Types.ObjectId(p.accountId) }]
    : [{ account: { $in: ids } }, { type: "transfer", transferTo: { $in: ids } }];
  const query: Record<string, unknown> = {
    // The owner's rows, only those touching a shared account, and nothing else.
    user: new Types.ObjectId(ctx.ownerId),
    isDeleted: { $ne: true },
    reviewStatus: { $ne: "voided" },
    $or: scope,
    $nor: [UNPAID_RECURRING],
    ...(p.type ? { type: p.type } : {}),
    ...(Object.keys(range).length ? { date: range } : {}),
  };
  if (ids.length === 0) return { currency: ctx.baseCurrency, data: [], total: 0, skip, limit };

  const [rows, total] = await Promise.all([
    Transaction.find(query)
      .select("account type amount currency category subcategory description date transferTo addedBy")
      .sort({ date: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<
        {
          _id: Types.ObjectId;
          account: Types.ObjectId;
          type: string;
          amount: number;
          currency?: string;
          category: string;
          subcategory?: string;
          description?: string;
          date: Date;
          transferTo?: Types.ObjectId;
          addedBy?: Types.ObjectId;
        }[]
      >(),
    Transaction.countDocuments(query),
  ]);

  const adderIds = [...new Set(rows.filter((r) => r.addedBy).map((r) => idStr(r.addedBy!)))];
  const adders = adderIds.length ? await User.find({ _id: { $in: adderIds } }).select("name").lean<UserBrief[]>() : [];
  const adderName = new Map(adders.map((u) => [idStr(u._id), u.name ?? null]));

  return {
    currency: ctx.baseCurrency,
    data: rows.map((r) => ({
      id: idStr(r._id),
      // A side of a transfer that is not shared is hidden, never named.
      account: allowed.has(idStr(r.account)) ? idStr(r.account) : null,
      transferTo: r.transferTo && allowed.has(idStr(r.transferTo)) ? idStr(r.transferTo) : null,
      type: r.type,
      amount: r.amount,
      category: r.category,
      subcategory: r.subcategory ?? null,
      description: r.description ?? null,
      date: r.date,
      addedBy: r.addedBy ? { id: idStr(r.addedBy), name: adderName.get(idStr(r.addedBy)) ?? null } : null,
    })),
    total,
    skip,
    limit,
  };
}

export async function sharedBudgetsView(ctx: ShareContext, month?: number, year?: number) {
  if (!ctx.share.includeBudgets) throw new ShareServiceError("NOT_FOUND", "Not found");
  const now = localDate(new Date(), ctx.timeZone);
  const y = year ?? now.year;
  const m = month ?? now.month;
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new ShareServiceError("VALIDATION", "Invalid month");
  }
  const budgets = await listBudgetsWithSpend(ctx.ownerId, y, m);
  return {
    currency: ctx.baseCurrency,
    month: m,
    year: y,
    // Spent counts the owner's spending in that category across all their accounts.
    budgets: budgets.map((b) => ({
      id: idStr(b._id as Types.ObjectId),
      category: b.category,
      limitAmount: b.limitAmount,
      effectiveLimit: b.effectiveLimit,
      spent: b.spent,
      rollover: Boolean(b.rollover),
      isActive: b.isActive !== false,
    })),
  };
}

export async function sharedSummary(ctx: ShareContext) {
  const now = localDate(new Date(), ctx.timeZone);
  const start = localMidnight(ctx.timeZone, now.year, now.month, 1);
  const end = localMidnight(ctx.timeZone, now.month === 12 ? now.year + 1 : now.year, (now.month % 12) + 1, 1);
  const balance = ctx.accounts.reduce((sum, a) => sum + a.balance, 0);

  const rows = ctx.accountIds.length
    ? await Transaction.aggregate<{ _id: string; total: number }>([
        {
          $match: {
            user: new Types.ObjectId(ctx.ownerId),
            account: { $in: ctx.accountIds },
            type: { $in: ["income", "expense"] },
            isDeleted: { $ne: true },
            reviewStatus: { $ne: "voided" },
            $nor: [UNPAID_RECURRING],
          },
        },
        { $addFields: activityDateAddFields() },
        { $match: { activityDate: { $gte: start, $lt: end } } },
        {
          $group: {
            // A confirmed refund comes off spending, it is not income.
            _id: {
              $cond: [{ $and: [{ $eq: ["$type", "income"] }, { $eq: ["$refundStatus", "confirmed"] }] }, "refund", "$type"],
            },
            total: { $sum: "$amount" },
          },
        },
      ])
    : [];
  const sum = (k: string) => rows.find((r) => r._id === k)?.total ?? 0;
  return {
    owner: { id: ctx.ownerId, name: ctx.ownerName },
    currency: ctx.baseCurrency,
    accountCount: ctx.accounts.length,
    balance,
    month: { year: now.year, month: now.month, income: sum("income"), expense: Math.max(0, sum("expense") - sum("refund")) },
  };
}

// ── Editor write ──────────────────────────────────────────────────────────

/**
 * An editor adds one plain income or expense to a shared account. It runs the
 * owner's own createTransaction (balance, budget alerts, ledger), with the
 * member as the ledger actor and `addedBy` on the row. A viewer is refused.
 */
export async function addSharedTransaction(ctx: ShareContext, member: AuthUser, input: SharedTransactionInput) {
  if (ctx.share.role !== "editor") {
    throw new ShareServiceError("FORBIDDEN_ROLE", "You can view this account but not add to it");
  }
  if (!ctx.accountIds.some((id) => idStr(id) === input.accountId)) throw new ShareServiceError("NOT_FOUND", "Not found");

  // `ctx` was read at the start of the request. Read the share again right before writing, so a
  // revoke, a role change or an account taken out of the share a moment ago is honoured.
  const live = await Share.findOne({ _id: ctx.share._id, owner: ctx.ownerId, member: member.id, status: "active" })
    .select("role accountIds")
    .lean<{ role: "viewer" | "editor"; accountIds: Types.ObjectId[] }>();
  if (!live || !live.accountIds.some((id) => idStr(id) === input.accountId)) throw new ShareServiceError("NOT_FOUND", "Not found");
  if (live.role !== "editor") throw new ShareServiceError("FORBIDDEN_ROLE", "You can view this account but not add to it");

  let result;
  try {
    result = await createTransaction({
      userId: ctx.ownerId,
      actor: member,
      accountId: input.accountId,
      type: input.type,
      amount: input.amount,
      category: input.category,
      description: input.description,
      note: input.note,
      date: input.date,
      tags: [],
      isRecurring: false,
      provenance: { source: "manual", addedBy: member.id },
    });
  } catch (err) {
    if (err instanceof TransactionServiceError && err.code === "ACCOUNT_NOT_FOUND") {
      throw new ShareServiceError("NOT_FOUND", "Not found");
    }
    throw err;
  }
  const txn = result.transaction as { _id: Types.ObjectId; date: Date };

  const accountName = ctx.accounts.find((a) => idStr(a._id) === input.accountId)?.name ?? "a shared account";
  await notify(
    ctx.ownerId,
    "Added to a shared account",
    `${member.name || member.email} added ${input.type === "income" ? "income" : "an expense"} to ${accountName}.`,
    { kind: "household_write", shareId: idStr(ctx.share._id), transactionId: idStr(txn._id) }
  );
  logger.info({ ownerId: ctx.ownerId, memberId: member.id, shareId: idStr(ctx.share._id) }, "household editor added a transaction");
  return {
    id: idStr(txn._id),
    account: input.accountId,
    type: input.type,
    amount: input.amount,
    currency: ctx.baseCurrency,
    category: input.category,
    description: input.description ?? null,
    note: input.note ?? null,
    date: txn.date,
    addedBy: { id: member.id, name: member.name || null },
  };
}
