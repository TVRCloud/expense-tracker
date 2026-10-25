import { createHash } from "crypto";
import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import logger from "@/lib/logger";
import AaConsent from "@/models/AaConsent";
import Account from "@/models/Account";
import Notification from "@/models/Notification";
import User from "@/models/User";
import { decryptField, encryptField } from "@/lib/crypto";
import { CAPTURE_KEY_ENV, ingestAaTransaction } from "@/lib/capture/ingest";
import { matchAccountForMessage } from "@/lib/capture/account-match";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";
import { aaConfigured, getAaProvider, providerByName } from "@/lib/aa/providers";
import { AaProviderError, type AaConsentStatus, type AaFinancialAccount, type AaProvider } from "@/lib/aa/provider";

// Account Aggregator (AA) sync: bank transactions pulled through a user's
// consent, as a second source next to SMS. The provider seam is src/lib/aa/;
// today only a sandbox exists, so this never reaches a bank (docs/security.md,
// "Account Aggregator"). Each transaction goes through ingestAaTransaction
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

async function loadConsent(userId: string, id: string): Promise<ConsentDoc> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) throw new AaServiceError("NOT_FOUND", "Consent not found");
  const c = await AaConsent.findOne({ _id: id, user: userId }).lean<ConsentDoc | null>();
  if (!c) throw new AaServiceError("NOT_FOUND", "Consent not found");
  return c;
}

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
  let created;
  try {
    // An opaque, stable id for the person: never the email or name.
    const userRef = createHash("sha256").update(`aa-user:${userId}`).digest("hex").slice(0, 32);
    created = await provider.createConsent({ userRef, durationDays: CONSENT_DAYS });
  } catch (err) {
    logger.error({ err: err instanceof AaProviderError ? err.code : "unknown", provider: provider.name }, "aa: could not start a consent");
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
    (err) => logger.error({ err }, "aa: could not record the notification")
  );
}

/** Records a provider-side status change once: only the call that really changes it notifies. */
async function applyStatus(c: ConsentDoc, status: AaConsentStatus, extra: Record<string, unknown> = {}) {
  if (status === c.status) return;
  const res = await AaConsent.updateOne(
    { _id: c._id, status: c.status },
    { $set: { status, ...(status === "revoked" ? { revokedAt: new Date() } : {}), ...extra } }
  );
  if (res.modifiedCount && (status === "expired" || status === "revoked" || status === "failed")) await notifyEnded(c, status);
}

async function mergeLinked(c: ConsentDoc, accounts: AaFinancialAccount[]): Promise<LinkedDoc[]> {
  const known = new Map((c.linkedAccounts ?? []).map((l) => [l.providerRef, l]));
  const out: LinkedDoc[] = [];
  const taken = new Set((c.linkedAccounts ?? []).filter((l) => l.mappedAccount).map((l) => l.mappedAccount!.toString()));
  for (const a of accounts.slice(0, 20)) {
    const old = known.get(a.ref);
    if (old) {
      out.push(old);
      continue;
    }
    // A new account: map it to one of the user's own when the digits and bank point at exactly one.
    const m = await matchAccountForMessage(c.user.toString(), { last4: a.last4, bankName: a.bankName, instrument: a.instrument }).catch(() => null);
    const pick = m?.accountId && !taken.has(m.accountId) ? m.accountId : null;
    if (pick) taken.add(pick);
    out.push({
      _id: new Types.ObjectId(),
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
  let state;
  try {
    state = await provider.consentStatus(handleOf(c));
  } catch (err) {
    if (err instanceof AaProviderError && err.code === "CONSENT_NOT_FOUND") {
      await applyStatus(c, "failed", { lastError: "not_found_at_provider" });
      return consentView(await loadConsent(userId, id));
    }
    logger.error({ err: err instanceof AaProviderError ? err.code : "unknown", consentId: id }, "aa: status check failed");
    throw new AaServiceError("PROVIDER_ERROR", "The bank linking provider could not be reached. Try again later.");
  }
  const linked = state.status === "active" || state.status === "paused" ? await mergeLinked(c, state.accounts) : c.linkedAccounts;
  await AaConsent.updateOne(
    { _id: c._id },
    { $set: { linkedAccounts: linked, ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}), lastError: null } }
  );
  const fresh = { ...c, linkedAccounts: linked } as ConsentDoc;
  await applyStatus(fresh, state.status, state.status === "revoked" ? { lastError: "revoked_at_provider" } : {});
  return consentView(await loadConsent(userId, id));
}

/** Sets or clears which of the user's own accounts a linked bank account feeds. */
export async function mapLinkedAccount(userId: string, id: string, linkedId: string, accountId: string | null): Promise<AaConsentView> {
  const c = await loadConsent(userId, id);
  const linked = c.linkedAccounts.find((l) => l._id.toString() === linkedId);
  if (!linked) throw new AaServiceError("NOT_FOUND", "Linked account not found");
  if (accountId) {
    if (!Types.ObjectId.isValid(accountId)) throw new AaServiceError("VALIDATION", "Account is invalid");
    const mine = await Account.exists({ _id: accountId, user: userId, isArchived: { $ne: true } });
    if (!mine) throw new AaServiceError("NOT_FOUND", "Account not found");
    // One of your accounts is fed by one linked account: two feeds into one would book the same payment twice.
    const clash = c.linkedAccounts.some((l) => l._id.toString() !== linkedId && l.mappedAccount?.toString() === accountId);
    if (clash) throw new AaServiceError("INVALID_STATE", "That account is already fed by another linked account");
  }
  await AaConsent.updateOne(
    { _id: c._id, user: userId, "linkedAccounts._id": linked._id },
    { $set: { "linkedAccounts.$.mappedAccount": accountId ? new Types.ObjectId(accountId) : null } }
  );
  return consentView(await loadConsent(userId, id));
}

/** Withdraws the consent now. Transactions already added stay. */
export async function revokeConsent(userId: string, id: string): Promise<{ consent: AaConsentView; providerRevoked: boolean }> {
  const c = await loadConsent(userId, id);
  if (c.status === "revoked") return { consent: consentView(c), providerRevoked: true };
  let providerRevoked = true;
  const provider = providerByName(c.provider);
  if (!provider) providerRevoked = false;
  else {
    try {
      await provider.revoke(handleOf(c));
    } catch (err) {
      providerRevoked = false;
      logger.error({ err: err instanceof AaProviderError ? err.code : "unknown", consentId: id }, "aa: provider did not confirm the revoke");
    }
  }
  // Sync stops either way. If the provider did not confirm, say so: the person may need to withdraw at the bank.
  await AaConsent.updateOne(
    { _id: c._id, user: userId },
    { $set: { status: "revoked", revokedAt: new Date(), lastError: providerRevoked ? null : "revoke_not_confirmed" } }
  );
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
      const state = await provider.consentStatus(handle);
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

    const started = Date.now();
    let processed = 0;
    const linkedUpdates: { id: Types.ObjectId; syncedUntil: Date; partial: boolean }[] = [];
    try {
      for (const l of c.linkedAccounts) {
        if (!l.mappedAccount) {
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
          const got = await provider.fetchTransactions(handle, { accountRef: l.providerRef, from, cursor, limit: PAGE_SIZE });
          for (const t of got.transactions) {
            if (processed >= SYNC_LIMITS.transactions || Date.now() - started > SYNC_LIMITS.budgetMs) {
              result.partial = true;
              break;
            }
            processed += 1;
            result.fetched += 1;
            if (t.currency !== "INR") {
              result.skippedCurrency += 1;
              continue;
            }
            const at = new Date(t.at);
            if (
              !t.id ||
              t.id.length > 200 ||
              !Number.isSafeInteger(t.amountMinor) ||
              t.amountMinor < 1 ||
              t.amountMinor > MAX_MINOR_AMOUNT ||
              Number.isNaN(at.getTime()) ||
              (t.type !== "income" && t.type !== "expense")
            ) {
              result.skippedInvalid += 1;
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
              at,
              narration: String(t.narration ?? "").slice(0, 300),
              reference: t.reference ? String(t.reference).slice(0, 60) : undefined,
              historical: at.getTime() < new Date(c.createdAt).getTime(),
            });
            if (out.body.status === "created") result.created += 1;
            else if (out.body.status === "updated") result.updated += 1;
            else if (out.body.status === "queued") result.queued += 1;
            else result.duplicates += 1;
            if (!newest || at.getTime() > newest.getTime()) newest = at;
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
    await AaConsent.updateOne({ _id: c._id }, { $set: { lastSyncAt: now, lastError: result.error ?? null } });
    return result;
  } finally {
    syncing.delete(key);
  }
}

/** On-demand sync for one consent. Refused when one just ran. */
export async function syncNow(userId: string, id: string, now = new Date()): Promise<AaSyncResult> {
  requireProvider();
  const c = await loadConsent(userId, id);
  if (c.status !== "active") throw new AaServiceError("INVALID_STATE", "This bank link is not active. Refresh its status first.");
  if (c.lastSyncAt && now.getTime() - new Date(c.lastSyncAt).getTime() < SYNC_COOLDOWN_MS) {
    const wait = Math.ceil((SYNC_COOLDOWN_MS - (now.getTime() - new Date(c.lastSyncAt).getTime())) / 1000);
    throw new AaServiceError("TOO_SOON", "This bank link was just read. Try again in a few minutes.", { retryAfterSeconds: wait });
  }
  return syncConsent(c, now);
}

// One sweep at a time per process (the timer and the cron route can overlap); a run that has gone this long is
// treated as hung so one stuck call cannot block every later run.
const RUN_STALE_AFTER_MS = 10 * 60 * 1000;
let runStartedAt: number | null = null;

/** Timer and cron entry: every active consent not read in the last hour. */
export async function syncAllConsents(now = new Date()): Promise<{ checked: number; created: number; skipped?: true }> {
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
    for (const c of due) {
      try {
        created += (await syncConsent(c, now)).created;
      } catch (err) {
        logger.error({ err, consentId: c._id.toString() }, "aa sync failed for a consent");
      }
    }
    return { checked: due.length, created };
  } finally {
    if (runStartedAt === startedAt) runStartedAt = null;
  }
}

/** Account deletion: withdraw every consent at the provider (best effort) and remove the records. */
export async function deleteAaDataForUser(userId: string): Promise<void> {
  await connectDB();
  const all = await AaConsent.find({ user: userId }).lean<ConsentDoc[]>();
  for (const c of all) {
    if (c.status === "revoked") continue;
    const provider = providerByName(c.provider);
    if (!provider) continue;
    try {
      await provider.revoke(handleOf(c));
    } catch (err) {
      logger.error({ err: err instanceof AaProviderError ? err.code : "unknown", consentId: c._id.toString() }, "aa: could not withdraw a consent while deleting an account");
    }
  }
  await AaConsent.deleteMany({ user: userId });
}
