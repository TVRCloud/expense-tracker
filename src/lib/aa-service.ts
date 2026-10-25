import { createHash } from "crypto";
import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import AaConsent from "@/models/AaConsent";
import Account from "@/models/Account";
import Notification from "@/models/Notification";
import AaAccountClaim from "@/models/AaAccountClaim";
import User from "@/models/User";
import { decryptField, encryptField } from "@/lib/crypto";
import { CAPTURE_KEY_ENV, ingestAaTransaction } from "@/lib/capture/ingest";
import { matchAccountForMessage } from "@/lib/capture/account-match";
import { aaConfigured, getAaProvider, providerByName } from "@/lib/aa/providers";
import {
  AaProviderError,
  consentStateSchema,
  createdConsentSchema,
  fetchPageSchema,
  transactionSchema,
  type AaConsentState,
  type AaConsentStatus,
  type AaCreatedConsent,
  type AaFinancialAccount,
  type AaProvider,
} from "@/lib/aa/provider";

// Account Aggregator (AA) sync: bank transactions pulled through a user's
// consent, as a second source next to SMS. The provider seam is src/lib/aa/;
// today only a sandbox exists, so this never reaches a bank (docs/account-aggregator.md). Each transaction goes through ingestAaTransaction
// (src/lib/capture/ingest.ts): the same matching against SMS captures and manual
// entries, and one captured message per provider transaction id, which makes a
// re-sync idempotent.

export type AaErrorCode = "NOT_CONFIGURED" | "NOT_FOUND" | "LIMIT" | "PROVIDER_ERROR" | "INVALID_STATE" | "TOO_SOON" | "VALIDATION";

export class AaServiceError extends Error {
  constructor(
    public code: AaErrorCode,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AaServiceError";
  }
}

const DAY = 24 * 60 * 60 * 1000;
/** Pending, active and paused consents one user may hold at once. */
export const MAX_LIVE_CONSENTS = 5;
export const CONSENT_DAYS = 180;
/** An on-demand sync of one consent is refused this soon after the last one. */
export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
/** The timer and cron route read a consent no more often than this. */
export const SYNC_INTERVAL_MS = 60 * 60 * 1000;
/** How far back the first sync reads. */
export const FIRST_SYNC_DAYS = 90;
/** Later syncs ask from a little before where the last one stopped; repeats are no-ops. */
export const OVERLAP_MS = 2 * DAY;
export const PAGE_SIZE = 100;
/** An entry dated more than a day ahead, or more than a day before the window asked for, is refused. */
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const SYNC_LIMITS = { pages: 10, transactions: 1000, budgetMs: 20_000 };

type LinkedDoc = {
  _id: Types.ObjectId;
  providerRef: string;
  bankName: string;
  maskedNumber: string;
  mappedAccount?: Types.ObjectId | null;
  syncedUntil?: Date | null;
  syncedPartial?: boolean;
};

type ConsentDoc = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  provider: string;
  consentHandle: Parameters<typeof decryptField>[0];
  handleHash: string;
  status: AaConsentStatus;
  expiresAt?: Date | null;
  linkedAccounts: LinkedDoc[];
  activeAt?: Date | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
  revokedAt?: Date | null;
  createdAt: Date;
};

export type AaConsentView = {
  id: string;
  provider: string;
  status: AaConsentStatus;
  createdAt: string;
  expiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  linkedAccounts: { id: string; bankName: string; last4: string; mappedAccountId: string | null; syncedUntil: string | null }[];
};

/** What a client may see of a consent. Never the provider's handle. */
export function consentView(c: ConsentDoc): AaConsentView {
  return {
    id: c._id.toString(),
    provider: c.provider,
    status: c.status,
    createdAt: new Date(c.createdAt).toISOString(),
    expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
    lastSyncAt: c.lastSyncAt ? new Date(c.lastSyncAt).toISOString() : null,
    lastError: c.lastError ?? null,
    linkedAccounts: (c.linkedAccounts ?? []).map((l) => ({
      id: l._id.toString(),
      bankName: l.bankName,
      last4: l.maskedNumber,
      mappedAccountId: l.mappedAccount ? l.mappedAccount.toString() : null,
      syncedUntil: l.syncedUntil ? new Date(l.syncedUntil).toISOString() : null,
    })),
  };
}

const LIVE: AaConsentStatus[] = ["pending", "active", "paused"];

function requireProvider(): AaProvider {
  const provider = getAaProvider();
  if (!provider) throw new AaServiceError("NOT_CONFIGURED", "Bank linking is not set up on this server");
  return provider;
}

function providerOf(c: ConsentDoc): AaProvider {
  const provider = providerByName(c.provider);
  if (!provider) throw new AaServiceError("NOT_CONFIGURED", "The bank linking provider for this consent is not available");
  return provider;
}

const handleOf = (c: ConsentDoc) => decryptField(c.consentHandle, CAPTURE_KEY_ENV);

// What a provider returns is untrusted: each answer is checked here before the rest of the code uses it. An answer
// that fails the check is a provider error (a short code in the log, never the content).
function checked<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AaProviderError("PROVIDER_ERROR", "invalid_provider_answer");
  return parsed.data;
}

/** Every provider call has a time limit; one that does not answer in time is a provider error. */
export const PROVIDER_TIMEOUT = { ms: 15_000 };

async function withTimeout<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(ctl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new AaProviderError("PROVIDER_ERROR", "timeout"));
        }, PROVIDER_TIMEOUT.ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A short code for the log: never the error object (it can carry a URL, headers or a token). */
const codeOf = (err: unknown) => (err instanceof AaProviderError ? err.code : err instanceof Error ? err.name : "unknown");

// ── One feed per account ────────────────────────────────────────────────────
// Two live bank links feeding one account would book every payment twice. The claim (AaAccountClaim, unique on
// user + account) is the atomic guard: it is taken before a mapping is written and released when the mapping goes.

const CLAIM_GRACE_MS = 60_000;
const CLAIM_ATTEMPTS = 5;
const isDuplicateKey = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

async function claimHolds(userId: string, claim: { consent: Types.ObjectId; linkedId: Types.ObjectId }, accountId: string): Promise<boolean> {
  const holder = await AaConsent.exists({
    _id: claim.consent,
    user: userId,
    status: { $in: LIVE },
    linkedAccounts: { $elemMatch: { _id: claim.linkedId, mappedAccount: new Types.ObjectId(accountId) } },
  });
  return Boolean(holder);
}

/** "new" when this call took the claim, "existing" when this linked account already held it, false when another holds it (or it could not be settled). */
async function claimAccount(userId: string, accountId: string, consentId: Types.ObjectId, linkedId: Types.ObjectId): Promise<"new" | "existing" | false> {
  const mine = { user: userId, account: new Types.ObjectId(accountId), consent: consentId, linkedId };
  // A few attempts: the holder can vanish between the failed insert and the read (then insert again). Bounded, so
  // a claim that keeps vanishing (or a read that keeps missing it) ends as "not claimed" instead of looping.
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    try {
      await AaAccountClaim.create(mine);
      return "new";
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
    const held = await AaAccountClaim.findOne({ user: userId, account: mine.account }).lean<{ _id: Types.ObjectId; consent: Types.ObjectId; linkedId: Types.ObjectId; updatedAt: Date } | null>();
    if (!held) continue;
    if (held.consent.equals(consentId) && held.linkedId.equals(linkedId)) return "existing";
    // A claim is taken just before its mapping is written, so a young one counts even before the mapping shows.
    if (Date.now() - new Date(held.updatedAt).getTime() < CLAIM_GRACE_MS) return false;
    if (await claimHolds(userId, held, accountId)) return false;
    // Stale (its consent ended or no longer maps here): take it over, but only if nobody else did first.
    const taken = await AaAccountClaim.findOneAndUpdate({ _id: held._id, consent: held.consent, linkedId: held.linkedId }, { $set: { consent: consentId, linkedId } });
    return taken ? "new" : false;
  }
  return false;
}

async function releaseClaim(userId: string, accountId: string | Types.ObjectId, consentId: Types.ObjectId, linkedId?: Types.ObjectId) {
  await AaAccountClaim.deleteMany({ user: userId, account: new Types.ObjectId(String(accountId)), consent: consentId, ...(linkedId ? { linkedId } : {}) });
}

async function loadConsent(userId: string, id: string): Promise<ConsentDoc> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) throw new AaServiceError("NOT_FOUND", "Consent not found");
  const c = await AaConsent.findOne({ _id: id, user: userId }).lean<ConsentDoc | null>();
  if (!c) throw new AaServiceError("NOT_FOUND", "Consent not found");
  return c;
}

/** The opaque id the provider is given for a person: a hash, never the email. Also the lookup key in the logs. */
const providerUserRef = (userId: string) => createHash("sha256").update(`aa-user:${userId}`).digest("hex").slice(0, 32);

/** Status of the feature and the user's consents, newest first. Works when the provider is off. */
export async function getAaStatus(userId: string): Promise<{ configured: boolean; provider: string | null; consents: AaConsentView[] }> {
  await connectDB();
  const provider = getAaProvider();
  const consents = await AaConsent.find({ user: userId }).sort({ createdAt: -1 }).limit(20).lean<ConsentDoc[]>();
  return { configured: provider !== null, provider: provider?.name ?? null, consents: consents.map(consentView) };
}

/** Starts a consent: the provider's consent screen address comes back once, in this answer only. */
export async function startConsent(userId: string): Promise<{ consent: AaConsentView; redirectUrl: string }> {
  const provider = requireProvider();
  await connectDB();
  const live = await AaConsent.countDocuments({ user: userId, status: { $in: LIVE } });
  if (live >= MAX_LIVE_CONSENTS) {
    throw new AaServiceError("LIMIT", `You can have at most ${MAX_LIVE_CONSENTS} bank links at once. Remove one first.`);
  }
  let created: AaCreatedConsent;
  try {
    // An opaque, stable id for the person: never the email or name.
    const userRef = providerUserRef(userId);
    created = checked(createdConsentSchema, await withTimeout((signal) => provider.createConsent({ userRef, durationDays: CONSENT_DAYS, signal })));
  } catch (err) {
    // A timeout aborts our side only: the provider may still have created the consent. The correlation id is the
    // person's opaque id (a hash, never the email), so a support lookup at the provider can find a stray consent.
    logger.error({ err: codeOf(err), provider: provider.name, correlationId: providerUserRef(userId) }, "aa: could not start a consent");
    throw new AaServiceError("PROVIDER_ERROR", "The bank linking provider could not be reached. Try again later.");
  }
  const doc = await AaConsent.create({
    user: userId,
    provider: provider.name,
    consentHandle: encryptField(created.handle, CAPTURE_KEY_ENV),
    handleHash: createHash("sha256").update(created.handle).digest("hex"),
    status: "pending",
    expiresAt: created.expiresAt,
  });
  // The count above and the insert are not atomic: requests at once can all pass it. Settle it after the insert:
  // the oldest live consents (by id) keep their place and the newer pending ones beyond the cap are removed, by
  // whichever request sees them first. A request whose consent was removed gives up. The cap holds in the end;
  // a consent can in rare races be removed after its request answered (its next call is a 404).
  const liveIds = await AaConsent.find({ user: userId, status: { $in: LIVE } }).sort({ _id: 1 }).select("_id").lean<{ _id: Types.ObjectId }[]>();
  if (liveIds.length > MAX_LIVE_CONSENTS) {
    const keep = liveIds.slice(0, MAX_LIVE_CONSENTS).map((l) => l._id);
    const excess = await AaConsent.find({ user: userId, status: "pending", _id: { $nin: keep } }).lean<ConsentDoc[]>();
    for (const x of excess) {
      // Withdraw at the provider first: a handle we stop tracking must not stay a live grant there.
      await withTimeout((signal) => providerByName(x.provider)!.revoke(handleOf(x), { signal })).catch(() => undefined);
    }
    await AaConsent.deleteMany({ user: userId, status: "pending", _id: { $in: excess.map((x) => x._id) } });
  }
  if (!(await AaConsent.exists({ _id: doc._id, user: userId }))) {
    await withTimeout((signal) => provider.revoke(created.handle, { signal })).catch(() => undefined);
    throw new AaServiceError("LIMIT", `You can have at most ${MAX_LIVE_CONSENTS} bank links at once. Remove one first.`);
  }
  return { consent: consentView(doc.toObject() as ConsentDoc), redirectUrl: created.redirectUrl };
}

async function notifyEnded(c: ConsentDoc, status: AaConsentStatus) {
  const copy: Partial<Record<AaConsentStatus, { title: string; body: string }>> = {
    expired: { title: "A bank link expired", body: "Automatic bank updates have stopped for it. Link the bank again to keep them coming." },
    revoked: { title: "A bank link was withdrawn", body: "The bank link was withdrawn at your bank or provider, so it stopped updating. Transactions it already added stay." },
    failed: { title: "A bank link stopped working", body: "The bank link could not be read any more, so it stopped updating." },
  };
  const n = copy[status];
  if (!n) return;
  await Notification.create({ user: c.user, type: "system", title: n.title, body: n.body, meta: { kind: "aa_consent", consentId: c._id.toString() } }).catch(
    (err) => logger.error({ err: codeOf(err) }, "aa: could not record the notification")
  );
}

/** Records a provider-side status change once: only the call that really changes it notifies. */
async function applyStatus(c: ConsentDoc, status: AaConsentStatus, extra: Record<string, unknown> = {}) {
  if (status === c.status) return;
  const res = await AaConsent.updateOne(
    { _id: c._id, status: c.status },
    { $set: { status, ...(status === "revoked" ? { revokedAt: new Date() } : {}), ...(status === "active" && !c.activeAt ? { activeAt: new Date() } : {}), ...extra } }
  );
  if (res.modifiedCount && (status === "expired" || status === "revoked" || status === "failed")) {
    await AaAccountClaim.deleteMany({ consent: c._id });
    await notifyEnded(c, status);
  }
}

/** The linked accounts the provider reports that this consent does not hold yet, auto-mapped where the match is clear. */
async function newLinkedAccounts(c: ConsentDoc, accounts: AaFinancialAccount[]): Promise<LinkedDoc[]> {
  const known = new Set((c.linkedAccounts ?? []).map((l) => l.providerRef));
  const out: LinkedDoc[] = [];
  for (const a of accounts.slice(0, 20)) {
    if (known.has(a.ref) || out.some((o) => o.providerRef === a.ref)) continue;
    // A new account: map it to one of the user's own when the digits and bank point at exactly one, and no
    // other bank link already feeds it (two feeds into one account would book each payment twice).
    const m = await matchAccountForMessage(c.user.toString(), { last4: a.last4, bankName: a.bankName, instrument: a.instrument }).catch(() => null);
    const id = new Types.ObjectId();
    const pick = m?.accountId && (await claimAccount(c.user.toString(), m.accountId, c._id, id)) ? m.accountId : null;
    out.push({
      _id: id,
      providerRef: a.ref,
      bankName: a.bankName.slice(0, 60),
      maskedNumber: a.last4.slice(-4),
      mappedAccount: pick ? new Types.ObjectId(pick) : null,
      syncedUntil: null,
    });
  }
  return out;
}

/** Asks the provider where the consent stands (the app calls this after the user approved it). */
export async function refreshConsent(userId: string, id: string): Promise<AaConsentView> {
  requireProvider();
  const c = await loadConsent(userId, id);
  if (c.status === "revoked" || c.status === "failed") return consentView(c);
  const provider = providerOf(c);
  let state: AaConsentState;
  try {
    state = checked(consentStateSchema, await withTimeout((signal) => provider.consentStatus(handleOf(c), { signal })));
  } catch (err) {
    if (err instanceof AaProviderError && err.code === "CONSENT_NOT_FOUND") {
      await applyStatus(c, "failed", { lastError: "not_found_at_provider" });
      return consentView(await loadConsent(userId, id));
    }
    logger.error({ err: codeOf(err), consentId: id }, "aa: status check failed");
    throw new AaServiceError("PROVIDER_ERROR", "The bank linking provider could not be reached. Try again later.");
  }
  // Only accounts new to the consent are added, one element at a time: a mapping the person changed since this
  // read, or another refresh adding the same account, is never overwritten.
  const added = state.status === "active" || state.status === "paused" ? await newLinkedAccounts(c, state.accounts) : [];
  for (const l of added) {
    const res = await AaConsent.updateOne({ _id: c._id, user: userId, "linkedAccounts.providerRef": { $ne: l.providerRef } }, { $push: { linkedAccounts: l } });
    // Another refresh added this account first: give back the account this one had claimed for it.
    if (!res.matchedCount && l.mappedAccount) await releaseClaim(userId, l.mappedAccount, c._id, l._id);
  }
  await AaConsent.updateOne({ _id: c._id }, { $set: { ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}), lastError: null } });
  await applyStatus(c, state.status, state.status === "revoked" ? { lastError: "revoked_at_provider" } : {});
  return consentView(await loadConsent(userId, id));
}

/** Sets or clears which of the user's own accounts a linked bank account feeds. */
export async function mapLinkedAccount(userId: string, id: string, linkedId: string, accountId: string | null): Promise<AaConsentView> {
  requireProvider();
  const c = await loadConsent(userId, id);
  const linked = c.linkedAccounts.find((l) => l._id.toString() === linkedId);
  if (!linked) throw new AaServiceError("NOT_FOUND", "Linked account not found");
  const previous = linked.mappedAccount ? linked.mappedAccount.toString() : null;
  if (accountId === previous) return consentView(c);
  let claim: "new" | "existing" | false = false;
  if (accountId) {
    if (!Types.ObjectId.isValid(accountId)) throw new AaServiceError("VALIDATION", "Account is invalid");
    const mine = await Account.exists({ _id: accountId, user: userId, isArchived: { $ne: true } });
    if (!mine) throw new AaServiceError("NOT_FOUND", "Account not found");
    // One of your accounts is fed by one live bank link: two feeds into one would book each payment twice. The
    // claim is atomic, so requests at once (even on different consents) cannot both win.
    claim = await claimAccount(userId, accountId, c._id, linked._id);
    if (!claim) {
      throw new AaServiceError("INVALID_STATE", "That account is already fed by another linked account");
    }
  }
  const res = await AaConsent.updateOne(
    { _id: c._id, user: userId, linkedAccounts: { $elemMatch: { _id: linked._id, mappedAccount: previous ? new Types.ObjectId(previous) : { $in: [null] } } } },
    { $set: { "linkedAccounts.$.mappedAccount": accountId ? new Types.ObjectId(accountId) : null } }
  );
  if (!res.matchedCount) {
    // The mapping changed under this request: undo the claim this call took (never one it only found) and let the caller retry.
    if (accountId && claim === "new") await releaseClaim(userId, accountId, c._id, linked._id);
    throw new AaServiceError("INVALID_STATE", "This linked account was changed by another request. Try again.");
  }
  if (previous) await releaseClaim(userId, previous, c._id, linked._id);
  return consentView(await loadConsent(userId, id));
}

/** Withdraws the consent now. Transactions already added stay. */
export async function revokeConsent(userId: string, id: string): Promise<{ consent: AaConsentView; providerRevoked: boolean }> {
  requireProvider();
  const c = await loadConsent(userId, id);
  // A revoke the provider never confirmed is tried again on the next call.
  if (c.status === "revoked" && c.lastError !== "revoke_not_confirmed") return { consent: consentView(c), providerRevoked: true };
  let providerRevoked = true;
  const provider = providerByName(c.provider);
  if (!provider) providerRevoked = false;
  else {
    try {
      await withTimeout((signal) => provider.revoke(handleOf(c), { signal }));
    } catch (err) {
      // A provider that no longer knows the consent has nothing left to withdraw.
      providerRevoked = err instanceof AaProviderError && err.code === "CONSENT_NOT_FOUND";
      if (!providerRevoked) logger.error({ err: codeOf(err), consentId: id }, "aa: provider did not confirm the revoke");
    }
  }
  // Sync stops either way. If the provider did not confirm, say so: the person may need to withdraw at the bank.
  await AaConsent.updateOne(
    { _id: c._id, user: userId },
    { $set: { status: "revoked", revokedAt: new Date(), lastError: providerRevoked ? null : "revoke_not_confirmed" } }
  );
  await AaAccountClaim.deleteMany({ consent: c._id });
  return { consent: consentView(await loadConsent(userId, id)), providerRevoked };
}

export type AaSyncResult = {
  consentId: string;
  status: AaConsentStatus;
  fetched: number;
  created: number;
  updated: number;
  duplicates: number;
  queued: number;
  skippedCurrency: number;
  skippedInvalid: number;
  unmappedAccounts: number;
  partial: boolean;
  error?: string;
  skipped?: "busy" | "not_active";
};

const syncing = new Set<string>();

function emptyResult(c: ConsentDoc): AaSyncResult {
  return {
    consentId: c._id.toString(),
    status: c.status,
    fetched: 0,
    created: 0,
    updated: 0,
    duplicates: 0,
    queued: 0,
    skippedCurrency: 0,
    skippedInvalid: 0,
    unmappedAccounts: 0,
    partial: false,
  };
}

/** Reads the new transactions of one consent. Bounded by page, count and time; safe to repeat. */
export async function syncConsent(c: ConsentDoc, now = new Date()): Promise<AaSyncResult> {
  const result = emptyResult(c);
  const key = c._id.toString();
  if (syncing.has(key)) return { ...result, skipped: "busy" };
  syncing.add(key);
  try {
    if (c.status !== "active") return { ...result, skipped: "not_active" };
    // Every attempt counts for the cooldown and the hourly interval, a failed one too: a provider that is down is
    // asked again later, not on every call.
    await AaConsent.updateOne({ _id: c._id }, { $set: { lastSyncAt: now } });
    const provider = providerByName(c.provider);
    if (!provider) {
      await AaConsent.updateOne({ _id: c._id }, { $set: { lastError: "provider_unavailable" } });
      return { ...result, error: "provider_unavailable" };
    }
    const handle = handleOf(c);

    // The consent may have ended since the last look: at the provider, or by its own expiry.
    if (c.expiresAt && now.getTime() >= new Date(c.expiresAt).getTime()) {
      await applyStatus(c, "expired");
      return { ...result, status: "expired" };
    }
    try {
      const state = checked(consentStateSchema, await withTimeout((signal) => provider.consentStatus(handle, { signal })));
      if (state.status !== "active") {
        await applyStatus(c, state.status, state.status === "revoked" ? { lastError: "revoked_at_provider" } : {});
        return { ...result, status: state.status, skipped: "not_active" };
      }
    } catch (err) {
      if (err instanceof AaProviderError && err.code === "CONSENT_NOT_FOUND") {
        await applyStatus(c, "failed", { lastError: "not_found_at_provider" });
        return { ...result, status: "failed" };
      }
      await AaConsent.updateOne({ _id: c._id }, { $set: { lastError: "provider_error" } });
      return { ...result, error: "provider_error" };
    }

    const owner = await User.findOne({ _id: c.user, isActive: { $ne: false } }).select("name email role").lean<{ _id: Types.ObjectId; name: string; email: string; role: string }>();
    if (!owner) return { ...result, error: "user_unavailable" };
    const actor = { id: owner._id.toString(), name: owner.name, email: owner.email, role: owner.role };

    // A mapped account that has been archived since is not fed: its payments would have nowhere to go.
    const mappedIds = c.linkedAccounts.filter((l) => l.mappedAccount).map((l) => l.mappedAccount!);
    const liveAccounts = new Set(
      (await Account.find({ _id: { $in: mappedIds }, user: c.user, isArchived: { $ne: true } }).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((a) => a._id.toString())
    );

    const started = Date.now();
    let processed = 0;
    const linkedUpdates: { id: Types.ObjectId; syncedUntil: Date; partial: boolean }[] = [];
    try {
      for (const l of c.linkedAccounts) {
        if (!l.mappedAccount || !liveAccounts.has(l.mappedAccount.toString())) {
          result.unmappedAccounts += 1;
          continue;
        }
        // A finished run is re-read from a little before where it stopped (late entries; repeats are no-ops). A run
        // that stopped at a limit resumes exactly there, so repeats cannot use up the budget and stall the feed.
        const from = l.syncedUntil
          ? new Date(new Date(l.syncedUntil).getTime() - (l.syncedPartial ? 0 : OVERLAP_MS))
          : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
        let cursor: string | undefined;
        let newest = l.syncedUntil ? new Date(l.syncedUntil) : null;
        let finished = false;
        for (let page = 0; page < SYNC_LIMITS.pages; page += 1) {
          // Out of time before asking for another page: stop here and resume next run.
          if (Date.now() - started > SYNC_LIMITS.budgetMs) {
            result.partial = true;
            break;
          }
          const got = checked(fetchPageSchema, await withTimeout((signal) => provider.fetchTransactions(handle, { accountRef: l.providerRef, from, cursor, limit: PAGE_SIZE, signal })));
          for (const raw of got.transactions) {
            if (processed >= SYNC_LIMITS.transactions || Date.now() - started > SYNC_LIMITS.budgetMs) {
              result.partial = true;
              break;
            }
            processed += 1;
            result.fetched += 1;
            // Every entry moves the resume point, a skipped one too (as long as its date is plausible): a long run
            // of invalid or foreign rows must not stall the link by using up the budget at the same place.
            // Only entries of this linked account with a date in range count: another account's rows must not move it.
            const rawObj = raw && typeof raw === "object" ? (raw as { at?: unknown; accountRef?: unknown }) : undefined;
            const rawAt = rawObj?.at;
            if (
              rawObj?.accountRef === l.providerRef &&
              rawAt instanceof Date &&
              !Number.isNaN(rawAt.getTime()) &&
              rawAt.getTime() <= now.getTime() + MAX_FUTURE_MS &&
              rawAt.getTime() >= from.getTime() - MAX_FUTURE_MS &&
              (!newest || rawAt.getTime() > newest.getTime())
            ) {
              newest = rawAt;
            }
            const parsed = transactionSchema.safeParse(raw);
            if (!parsed.success) {
              result.skippedInvalid += 1;
              continue;
            }
            const t = parsed.data;
            // Only this linked account's entries, and only dates in range: a provider answering with another
            // account's rows, or with a date far in the future or before the window asked for, must not land here.
            if (t.accountRef !== l.providerRef || t.at.getTime() > now.getTime() + MAX_FUTURE_MS || t.at.getTime() < from.getTime() - MAX_FUTURE_MS) {
              result.skippedInvalid += 1;
              continue;
            }
            if (t.currency !== "INR") {
              result.skippedCurrency += 1;
              continue;
            }
            const out = await ingestAaTransaction({
              user: actor,
              provider: c.provider,
              providerTxnId: t.id,
              accountId: l.mappedAccount.toString(),
              bankName: l.bankName,
              last4: l.maskedNumber,
              type: t.type,
              amountMinor: t.amountMinor,
              at: t.at,
              narration: t.narration.slice(0, 300),
              reference: t.reference,
              historical: t.at.getTime() < new Date(c.activeAt ?? c.createdAt).getTime(),
            });
            if (out.body.status === "created") result.created += 1;
            else if (out.body.status === "updated") result.updated += 1;
            else if (out.body.status === "queued") result.queued += 1;
            else result.duplicates += 1;
          }
          if (result.partial) break;
          if (!got.nextCursor) {
            finished = true;
            break;
          }
          cursor = got.nextCursor;
        }
        if (!finished) result.partial = true;
        // Read up to now when the feed ended; otherwise up to the newest entry handled (the feed is oldest first).
        const until = finished ? now : newest;
        if (until) linkedUpdates.push({ id: l._id, syncedUntil: until, partial: !finished });
        if (result.partial) break;
      }
    } catch (err) {
      if (!(err instanceof AaProviderError)) throw err;
      result.error = "provider_error";
      logger.error({ err: err.code, consentId: key }, "aa: sync stopped by a provider error");
    }

    for (const u of linkedUpdates) {
      await AaConsent.updateOne({ _id: c._id, "linkedAccounts._id": u.id }, { $set: { "linkedAccounts.$.syncedUntil": u.syncedUntil, "linkedAccounts.$.syncedPartial": u.partial } });
    }
    // Only while still active: a revoke that landed during the run keeps its own marker (revoke_not_confirmed).
    await AaConsent.updateOne({ _id: c._id, status: "active" }, { $set: { lastSyncAt: now, lastError: result.error ?? null } });
    return result;
  } finally {
    syncing.delete(key);
  }
}

/** On-demand sync for one consent. Refused when one just ran or is running. */
export async function syncNow(userId: string, id: string, now = new Date()): Promise<AaSyncResult> {
  requireProvider();
  const c = await loadConsent(userId, id);
  if (c.status !== "active") throw new AaServiceError("INVALID_STATE", "This bank link is not active. Refresh its status first.");
  if (syncing.has(c._id.toString())) {
    throw new AaServiceError("TOO_SOON", "This bank link is being read right now. Try again in a minute.", { retryAfterSeconds: 60 });
  }
  if (c.lastSyncAt && now.getTime() - new Date(c.lastSyncAt).getTime() < SYNC_COOLDOWN_MS) {
    const wait = Math.ceil((SYNC_COOLDOWN_MS - (now.getTime() - new Date(c.lastSyncAt).getTime())) / 1000);
    throw new AaServiceError("TOO_SOON", "This bank link was just read. Try again in a few minutes.", { retryAfterSeconds: wait });
  }
  const res = await syncConsent(c, now);
  // Lost a race for the claim between the check above and here.
  if (res.skipped === "busy") throw new AaServiceError("TOO_SOON", "This bank link is being read right now. Try again in a minute.", { retryAfterSeconds: 60 });
  return res;
}

// One sweep at a time per process (the timer and cron route can overlap); a run that has gone this long is
// treated as hung so one stuck call cannot block every later run.
const RUN_STALE_AFTER_MS = 10 * 60 * 1000;
/** A sweep stops starting new consents after this long (the cron route's maxDuration is 300 s). The rest wait for the next run. */
export const SWEEP_LIMITS = { budgetMs: 240_000 };
let runStartedAt: number | null = null;

/** Timer and cron entry: every active consent not read in the last hour, longest unread first. */
export async function syncAllConsents(now = new Date()): Promise<{ checked: number; created: number; skipped?: true; partial?: true }> {
  if (!aaConfigured()) return { checked: 0, created: 0 };
  const startedAt = Date.now();
  if (runStartedAt !== null && startedAt - runStartedAt < RUN_STALE_AFTER_MS) {
    logger.warn({ runningForMs: startedAt - runStartedAt }, "aa sync skipped: a run is still going");
    return { checked: 0, created: 0, skipped: true };
  }
  if (runStartedAt !== null) logger.warn({ runningForMs: startedAt - runStartedAt }, "aa sync: an earlier run looks hung, starting a new one");
  runStartedAt = startedAt;
  try {
    await connectDB();
    const due = await AaConsent.find({
      status: "active",
      $or: [{ lastSyncAt: null }, { lastSyncAt: { $lte: new Date(now.getTime() - SYNC_INTERVAL_MS) } }],
    })
      .sort({ lastSyncAt: 1 })
      .limit(200)
      .lean<ConsentDoc[]>();
    let created = 0;
    let checkedCount = 0;
    let partial = false;
    for (const c of due) {
      // Out of time: stop here. Every consent read so far has a fresh lastSyncAt, so the next run starts with the rest.
      if (Date.now() - startedAt > SWEEP_LIMITS.budgetMs) {
        partial = true;
        break;
      }
      checkedCount += 1;
      try {
        created += (await syncConsent(c, now)).created;
      } catch (err) {
        logger.error({ err: codeOf(err), consentId: c._id.toString() }, "aa sync failed for a consent");
      }
    }
    return { checked: checkedCount, created, ...(partial ? { partial: true as const } : {}) };
  } finally {
    if (runStartedAt === startedAt) runStartedAt = null;
  }
}

/**
 * Account deletion: withdraw every consent at its provider and remove the records.
 * - A consent already withdrawn is done, unless the withdrawal was never confirmed (`revoke_not_confirmed`): that
 *   one is tried again. A provider that no longer knows the consent counts as withdrawn.
 * - A consent whose provider is not registered here (AA_PROVIDER unset, or the sandbox refused in production)
 *   cannot be withdrawn from this server at all. Its record is deleted anyway, so the person is not stuck, and its
 *   id, provider and the correlation id (the opaque person id the provider was given) are logged so it can be
 *   found and withdrawn by hand. The grant may stay live there.
 * - A consent whose registered provider failed to withdraw it is kept and counted in `remaining`: the grant is not
 *   lost with its handle, and the caller refuses the deletion until it can be withdrawn.
 */
export async function deleteAaDataForUser(userId: string): Promise<{ remaining: number }> {
  await connectDB();
  const all = await AaConsent.find({ user: userId }).lean<ConsentDoc[]>();
  const done: Types.ObjectId[] = [];
  let remaining = 0;
  for (const c of all) {
    if (c.status === "revoked" && c.lastError !== "revoke_not_confirmed") {
      done.push(c._id);
      continue;
    }
    const provider = providerByName(c.provider);
    if (!provider) {
      logger.warn({ consentId: c._id.toString(), provider: c.provider, correlationId: providerUserRef(userId) }, "aa: consent deleted without a provider to withdraw it; the grant may still be live at the provider");
      done.push(c._id);
      continue;
    }
    try {
      await withTimeout((signal) => provider.revoke(handleOf(c), { signal }));
      done.push(c._id);
    } catch (err) {
      if (err instanceof AaProviderError && err.code === "CONSENT_NOT_FOUND") {
        done.push(c._id);
        continue;
      }
      remaining += 1;
      logger.error({ err: codeOf(err), consentId: c._id.toString() }, "aa: could not withdraw a consent while deleting an account");
    }
  }
  await AaConsent.deleteMany({ user: userId, _id: { $in: done } });
  await AaAccountClaim.deleteMany({ user: userId, consent: { $in: done } });
  if (remaining) logger.warn({ remaining }, "aa: consents kept because they could not be withdrawn");
  return { remaining };
}

/**
 * After the account is deleted: whatever bank link records could not be withdrawn are removed, so encrypted handles
 * do not sit under a deleted person. Each is logged (consent id, provider, correlation id) so the grant can be
 * found and withdrawn at the provider by hand.
 */
export async function purgeAaRecordsOfDeletedUser(userId: string): Promise<number> {
  await connectDB();
  const left = await AaConsent.find({ user: userId }).select("_id provider").lean<{ _id: Types.ObjectId; provider: string }[]>();
  for (const c of left) {
    logger.error({ consentId: c._id.toString(), provider: c.provider, correlationId: providerUserRef(userId) }, "aa: consent removed with a deleted account without being withdrawn; it may still be live at the provider");
  }
  await AaConsent.deleteMany({ user: userId });
  await AaAccountClaim.deleteMany({ user: userId });
  return left.length;
}
