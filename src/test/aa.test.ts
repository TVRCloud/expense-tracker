import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", () => ({ redis: null }));

process.env.CAPTURE_ENCRYPTION_KEY = "test-capture-encryption-key-at-least-32-chars";
process.env.CRON_SECRET = "test-cron-secret-aa";

let mongod: MongoMemoryReplSet;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongod.getUri();
  const { default: connectDB } = await import("@/lib/mongodb");
  await connectDB();
});

afterEach(async () => {
  const { resetAuthCacheForTests } = await import("@/lib/integrations/auth");
  const { resetRateLimitWindowsForTests } = await import("@/lib/integrations/rate-limit");
  const { sandboxControl } = await import("@/lib/aa/sandbox");
  resetAuthCacheForTests();
  resetRateLimitWindowsForTests();
  sandboxControl.reset();
  delete process.env.AA_PROVIDER;
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const KEY_A = "test-aa-api-key-user-a";
const KEY_B = "test-aa-api-key-user-b";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Account Aggregator sync (framework, sandbox provider)", () => {
  let a: string;
  let b: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const ua = await User.create({ name: "A", email: `a${Date.now()}${Math.random()}@x.com`, password: "h", isActive: true });
    const ub = await User.create({ name: "B", email: `b${Date.now()}${Math.random()}@x.com`, password: "h", isActive: true });
    await ApiKey.create({ user: ua._id, label: "phone", keyHash: hashKey(KEY_A), lastFour: KEY_A.slice(-4) });
    await ApiKey.create({ user: ub._id, label: "phone", keyHash: hashKey(KEY_B), lastFour: KEY_B.slice(-4) });
    a = ua._id.toString();
    b = ub._id.toString();
  });

  function req(path: string, method: string, key = KEY_A, body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const idem = (extra = "") => ({ "idempotency-key": `aa-${n + 1}${extra}` });

  async function status(key = KEY_A) {
    const { GET } = await import("@/app/api/integrations/aa/route");
    return GET(req("aa", "GET", key), {});
  }
  async function create(key = KEY_A, headers: Record<string, string> = idem()) {
    const { POST } = await import("@/app/api/integrations/aa/consents/route");
    return POST(req("aa/consents", "POST", key, undefined, headers), {});
  }
  async function refresh(id: string, key = KEY_A) {
    const { POST } = await import("@/app/api/integrations/aa/consents/[id]/refresh/route");
    return POST(req(`aa/consents/${id}/refresh`, "POST", key), { params: Promise.resolve({ id }) });
  }
  async function revoke(id: string, key = KEY_A, headers: Record<string, string> = idem()) {
    const { POST } = await import("@/app/api/integrations/aa/consents/[id]/revoke/route");
    return POST(req(`aa/consents/${id}/revoke`, "POST", key, undefined, headers), { params: Promise.resolve({ id }) });
  }
  async function syncRoute(id: string, key = KEY_A) {
    const { POST } = await import("@/app/api/integrations/aa/consents/[id]/sync/route");
    return POST(req(`aa/consents/${id}/sync`, "POST", key), { params: Promise.resolve({ id }) });
  }
  async function mapRoute(id: string, linkedId: string, accountId: string | null, key = KEY_A) {
    const { PATCH } = await import("@/app/api/integrations/aa/consents/[id]/accounts/[linkedId]/route");
    return PATCH(req(`aa/consents/${id}/accounts/${linkedId}`, "PATCH", key, { accountId }, idem()), {
      params: Promise.resolve({ id, linkedId }),
    });
  }

  async function models() {
    const M = async (name: string): Promise<mongoose.Model<Json>> => (await import(`@/models/${name}`)).default;
    const [Account, Transaction, CapturedMessage, AaConsent, Notification] = await Promise.all(
      ["Account", "Transaction", "CapturedMessage", "AaConsent", "Notification"].map(M)
    );
    return { Account, Transaction, CapturedMessage, AaConsent, Notification };
  }

  /** A consent made, approved and with the HDFC feed mapped to a saved account that has digits 1234. */
  async function linked(userId = a, key = KEY_A) {
    process.env.AA_PROVIDER = "sandbox";
    const { Account } = await models();
    const bank = await Account.create({ user: userId, name: "HDFC Savings", type: "bank", balance: 100000, smsLastFour: ["1234"] });
    const res = await create(key);
    const made = (await res.json()).data as Json;
    const refreshed = (await (await refresh(made.consent.id, key)).json()).data.consent as Json;
    return { bank, consentId: made.consent.id as string, consent: refreshed };
  }

  describe("when no provider is set", () => {
    it("reports configured:false and refuses everything else with AA_NOT_CONFIGURED", async () => {
      const res = await status();
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ configured: false, provider: null, consents: [] });

      const made = await create();
      expect(made.status).toBe(503);
      expect((await made.json()).error.code).toBe("AA_NOT_CONFIGURED");
      expect((await refresh("64b000000000000000000000")).status).toBe(503);
    });

    it("leaves the rest of the app alone: nothing is stored, the cron route is a no-op", async () => {
      await create();
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({})).toBe(0);
      const { GET } = await import("@/app/api/cron/aa-sync/route");
      const unauth = await GET(new NextRequest("http://localhost/api/cron/aa-sync"));
      expect(unauth.status).toBe(401);
      const ok = await GET(new NextRequest("http://localhost/api/cron/aa-sync", { headers: { authorization: "Bearer test-cron-secret-aa" } }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, checked: 0, created: 0 });
    });

    it("an unknown AA_PROVIDER name also counts as not configured", async () => {
      process.env.AA_PROVIDER = "no-such-provider";
      expect((await create()).status).toBe(503);
    });
  });

  describe("consent lifecycle with the sandbox", () => {
    it("starts a consent, keeps the handle secret and encrypted, and returns the consent screen address once", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const res = await create();
      expect(res.status).toBe(201);
      const text = JSON.stringify(await res.clone().json());
      const body = (await res.json()).data as Json;
      expect(body.redirectUrl).toMatch(/^https:\/\/aa-sandbox\.example\/consent\//);
      expect(body.consent).toMatchObject({ provider: "sandbox", status: "pending", linkedAccounts: [] });
      expect(text).not.toMatch(/sbx_/);
      expect(text).not.toMatch(/consentHandle|handleHash/);

      const { AaConsent } = await models();
      const stored = await AaConsent.findOne({ user: a }).lean<Json>();
      expect(stored?.consentHandle?.ciphertext).toBeTruthy();
      expect(JSON.stringify(stored)).not.toMatch(/sbx_[0-9a-f]{12}/);

      const st = JSON.stringify((await (await status()).json()).data);
      expect(st).not.toMatch(/sbx_/);
      expect(st).not.toMatch(/consentHandle|handleHash|redirectUrl/);
    });

    it("an idempotent replay answers the same consent with no redirect address, and creates no second consent", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const headers = { "idempotency-key": "aa-same-key" };
      const first = (await (await create(KEY_A, headers)).json()).data as Json;
      const again = await create(KEY_A, headers);
      expect(again.status).toBe(201);
      const second = (await again.json()).data as Json;
      expect(second.consent.id).toBe(first.consent.id);
      expect(second.redirectUrl).toBeNull();
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({ user: a })).toBe(1);
    });

    it("needs an Idempotency-Key on writes", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const res = await create(KEY_A, {});
      expect(res.status).toBe(400);
    });

    it("refresh reads the status, fills the linked banks and maps by digits", async () => {
      const { bank, consent } = await linked();
      expect(consent.status).toBe("active");
      expect(consent.linkedAccounts).toHaveLength(2);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const axis = consent.linkedAccounts.find((l: Json) => l.bankName === "Axis Bank");
      expect(hdfc).toMatchObject({ last4: "1234", mappedAccountId: String(bank._id) });
      expect(axis).toMatchObject({ last4: "9876", mappedAccountId: null });
      expect(JSON.stringify(consent)).not.toMatch(/providerRef|acct-/);
    });

    it("stays pending until the person approves", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      sandboxControl.setAutoApprove(false);
      const made = (await (await create()).json()).data as Json;
      const polled = (await (await refresh(made.consent.id)).json()).data.consent as Json;
      expect(polled.status).toBe("pending");
      expect(polled.linkedAccounts).toEqual([]);
    });

    it("limits live consents per user", async () => {
      process.env.AA_PROVIDER = "sandbox";
      for (let i = 0; i < 5; i += 1) expect((await create()).status).toBe(201);
      const sixth = await create();
      expect(sixth.status).toBe(409);
      expect((await sixth.json()).error.reason).toBe("limit");
    });

    it("a provider failure on start answers AA_PROVIDER_ERROR and stores nothing", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      sandboxControl.failNext(1);
      const res = await create();
      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe("AA_PROVIDER_ERROR");
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({})).toBe(0);
    });

    it("maps and unmaps a linked account, refuses an account that is not yours or already fed", async () => {
      const { consentId, consent, bank } = await linked();
      const { Account } = await models();
      const axis = consent.linkedAccounts.find((l: Json) => l.bankName === "Axis Bank");
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const second = await Account.create({ user: a, name: "Axis", type: "bank", balance: 0 });
      const theirs = await Account.create({ user: b, name: "Other", type: "bank", balance: 0 });

      const ok = await mapRoute(consentId, axis.id, String(second._id));
      expect(ok.status).toBe(200);
      expect(((await ok.json()).data.consent.linkedAccounts.find((l: Json) => l.id === axis.id) as Json).mappedAccountId).toBe(String(second._id));

      expect((await mapRoute(consentId, axis.id, String(theirs._id))).status).toBe(404);
      const clash = await mapRoute(consentId, axis.id, String(bank._id));
      expect(clash.status).toBe(409);

      const cleared = await mapRoute(consentId, hdfc.id, null);
      expect(((await cleared.json()).data.consent.linkedAccounts.find((l: Json) => l.id === hdfc.id) as Json).mappedAccountId).toBeNull();
      expect((await mapRoute(consentId, "64b000000000000000000001", null)).status).toBe(404);
    });
  });

  describe("sync", () => {
    it("books the feed through the capture path: source aa, not in the review inbox, history leaves the balance alone", async () => {
      const { bank, consentId } = await linked();
      const res = await syncRoute(consentId);
      expect(res.status).toBe(200);
      const sync = (await res.json()).data.sync as Json;
      // Three HDFC entries are mapped; the Axis one is not.
      expect(sync).toMatchObject({ fetched: 3, created: 3, duplicates: 0, unmappedAccounts: 1, partial: false, status: "active" });

      const { Transaction, Account, CapturedMessage } = await models();
      const rows = await Transaction.find({ user: a }).sort({ amount: 1 }).lean<Json[]>();
      expect(rows.map((r) => [r.type, r.amount])).toEqual([
        ["expense", 45000],
        ["expense", 120000],
        ["income", 5000000],
      ]);
      for (const r of rows) {
        expect(r.source).toBe("aa");
        expect(r.reviewStatus ?? null).toBeNull();
        expect(r.account.toString()).toBe(String(bank._id));
        expect(r.captures).toHaveLength(1);
      }
      // All three are older than the link: history, so no balance change.
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      const caps = await CapturedMessage.find({ user: a, channel: "aa" }).lean<Json[]>();
      expect(caps).toHaveLength(3);
      expect(caps.every((c) => c.sourcePriority === 2)).toBe(true);
    });

    it("an entry made after the link moves the balance like any capture", async () => {
      const { bank, consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const handle = await handleOf(consentId);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      sandboxControl.addTransactions(handle, await providerRef(consentId, hdfc.id), [
        { id: "sbx-new-1", accountRef: await providerRef(consentId, hdfc.id), type: "expense", amountMinor: 25000, currency: "INR", at: new Date(), narration: "UPI/CHAI POINT", reference: "555500001111" },
      ]);
      await syncRoute(consentId);
      const { Account, Transaction } = await models();
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(75000);
      const row = await Transaction.findOne({ user: a, amount: 25000 }).lean<Json>();
      expect(row?.description).toBe("UPI/CHAI POINT");
    });

    it("is idempotent: reading the same feed again adds nothing", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const ref = await providerRef(consentId, hdfc.id);
      // One entry from today, which the next read (it starts a little before the last one stopped) sees again.
      sandboxControl.addTransactions(await handleOf(consentId), ref, [
        { id: "today-1", accountRef: ref, type: "expense", amountMinor: 3300, currency: "INR", at: new Date(), narration: "UPI/BUS" },
      ]);
      await syncRoute(consentId);
      const { syncNow } = await import("@/lib/aa-service");
      const again = await syncNow(a, consentId, new Date(Date.now() + 10 * 60 * 1000));
      expect(again.created).toBe(0);
      expect(again.duplicates).toBe(1);
      const { Transaction, CapturedMessage } = await models();
      expect(await Transaction.countDocuments({ user: a })).toBe(4);
      expect(await CapturedMessage.countDocuments({ user: a, channel: "aa" })).toBe(4);
    });

    it("refuses a read right after another with retryAfterSeconds", async () => {
      const { consentId } = await linked();
      expect((await syncRoute(consentId)).status).toBe(200);
      const soon = await syncRoute(consentId);
      expect(soon.status).toBe(429);
      expect((await soon.json()).error.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("does not book the same payment twice when an SMS already captured it", async () => {
      const { consentId, bank } = await linked();
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const when = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      when.setUTCHours(13, 15, 0, 0);
      const dd = String(when.getUTCDate()).padStart(2, "0");
      const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
      const sms = `Rs.450.00 debited from A/c XX1234 on ${dd}-${mm}-${String(when.getUTCFullYear()).slice(2)} to VPA swiggy@icici. UPI Ref 100000000002. Not you? Call 18002586161`;
      const first = await ingestCapture({
        user: { id: a, name: "A", email: "a@x.com", role: "user" },
        channel: "sms",
        text: sms,
        receivedAt: when,
        sender: "VM-HDFCBK",
      });
      expect(first.body.status).toBe("created");

      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync.created).toBe(2);
      expect(sync.duplicates).toBe(1);
      const { Transaction, CapturedMessage } = await models();
      const swiggy = await Transaction.find({ user: a, amount: 45000 }).lean<Json[]>();
      expect(swiggy).toHaveLength(1);
      // The SMS stays the source of truth; the bank entry is a supporting record.
      expect(swiggy[0].source).toBe("sms");
      expect(swiggy[0].account.toString()).toBe(String(bank._id));
      const aaCap = await CapturedMessage.findOne({ user: a, channel: "aa", "eventKey.amount": 45000 }).lean<Json>();
      expect(aaCap).toMatchObject({ outcome: "duplicate", role: "supporting" });
    });

    it("an entry made by hand is matched, not duplicated, and its own values are kept", async () => {
      const { consentId, bank } = await linked();
      const { Transaction } = await models();
      const when = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      when.setUTCHours(7, 40, 0, 0);
      const manual = await Transaction.create({
        user: a, account: bank._id, type: "expense", amount: 120000, category: "Groceries", description: "Big basket order", date: when,
      });
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ created: 2, duplicates: 1 });
      expect(await Transaction.countDocuments({ user: a, amount: 120000 })).toBe(1);
      const kept = await Transaction.findById(manual._id).lean<Json>();
      expect(kept).toMatchObject({ category: "Groceries", description: "Big basket order", source: "manual" });
      expect(kept?.captures).toHaveLength(1);
    });

    it("matches a row from before captures existed (no captures field)", async () => {
      const { consentId, bank } = await linked();
      const { Transaction } = await models();
      const when = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      when.setUTCHours(8, 0, 0, 0);
      await Transaction.collection.insertOne({
        user: new mongoose.Types.ObjectId(a), account: bank._id, type: "expense", amount: 120000, currency: "INR",
        category: "Groceries", date: when, source: "manual", isDeleted: false, createdAt: when, updatedAt: when,
      });
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ created: 2, duplicates: 1 });
      expect(await Transaction.countDocuments({ user: a, amount: 120000 })).toBe(1);
    });

    it("one bank entry claims one manual row: two equal manual rows keep one for the next entry", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { Transaction } = await models();
      const handle = await handleOf(consentId);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const ref = await providerRef(consentId, hdfc.id);
      const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
      day.setUTCHours(9, 0, 0, 0);
      const accountId = hdfc.mappedAccountId;
      await Transaction.create([
        { user: a, account: accountId, type: "expense", amount: 2000, category: "Food", date: day },
        { user: a, account: accountId, type: "expense", amount: 2000, category: "Food", date: day },
      ]);
      sandboxControl.setTransactions(handle, ref, [
        { id: "e1", accountRef: ref, type: "expense", amountMinor: 2000, currency: "INR", at: day, narration: "TEA" },
        { id: "e2", accountRef: ref, type: "expense", amountMinor: 2000, currency: "INR", at: new Date(day.getTime() + 60_000), narration: "TEA" },
        { id: "e3", accountRef: ref, type: "expense", amountMinor: 2000, currency: "INR", at: new Date(day.getTime() + 120_000), narration: "TEA" },
      ]);
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ created: 1, duplicates: 2 });
      expect(await Transaction.countDocuments({ user: a, amount: 2000 })).toBe(3);
    });

    it("skips a feed in another currency and an invalid amount, and counts them", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const handle = await handleOf(consentId);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const ref = await providerRef(consentId, hdfc.id);
      sandboxControl.setTransactions(handle, ref, [
        { id: "u1", accountRef: ref, type: "expense", amountMinor: 1500, currency: "USD", at: new Date(), narration: "AMZN US" },
        { id: "u2", accountRef: ref, type: "expense", amountMinor: -5, currency: "INR", at: new Date(), narration: "BAD" },
        { id: "u3", accountRef: ref, type: "expense", amountMinor: 1.5, currency: "INR", at: new Date(), narration: "BAD" },
        { id: "u4", accountRef: ref, type: "expense", amountMinor: 700, currency: "INR", at: new Date(), narration: "OK" },
      ]);
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ fetched: 4, created: 1, skippedCurrency: 1, skippedInvalid: 2 });
    });

    it("is bounded: a long feed is read in runs and nothing is lost or doubled", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { SYNC_LIMITS, syncNow } = await import("@/lib/aa-service");
      const handle = await handleOf(consentId);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const ref = await providerRef(consentId, hdfc.id);
      const start = Date.now() - 20 * 24 * 60 * 60 * 1000;
      const feed = Array.from({ length: 70 }, (_, i) => ({
        id: `bulk-${i}`, accountRef: ref, type: "expense" as const, amountMinor: 100 + i, currency: "INR",
        at: new Date(start + i * 60 * 60 * 1000), narration: `BULK ${i}`,
      }));
      sandboxControl.setTransactions(handle, ref, feed);
      const saved = { ...SYNC_LIMITS };
      SYNC_LIMITS.transactions = 30;
      try {
        const first = await syncNow(a, consentId, new Date());
        expect(first).toMatchObject({ partial: true, created: 30 });
        let created = first.created;
        let t = Date.now();
        for (let i = 0; i < 6 && created < 70; i += 1) {
          t += 10 * 60 * 1000;
          const next = await syncNow(a, consentId, new Date(t));
          created += next.created;
        }
        expect(created).toBe(70);
      } finally {
        Object.assign(SYNC_LIMITS, saved);
      }
      const { Transaction } = await models();
      expect(await Transaction.countDocuments({ user: a, source: "aa", description: /^BULK/ })).toBe(70);
    });

    it("pages through a feed larger than one page", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { PAGE_SIZE } = await import("@/lib/aa-service");
      const handle = await handleOf(consentId);
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      const ref = await providerRef(consentId, hdfc.id);
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const total = PAGE_SIZE + 5;
      sandboxControl.setTransactions(
        handle,
        ref,
        Array.from({ length: total }, (_, i) => ({
          id: `pg-${i}`, accountRef: ref, type: "income" as const, amountMinor: 10 + i, currency: "INR", at: new Date(start + i * 60_000), narration: `PG ${i}`,
        }))
      );
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ fetched: total, created: total, partial: false });
    });

    it("a provider error mid-way keeps what was read, reports provider_error and the next run continues", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { syncNow } = await import("@/lib/aa-service");
      sandboxControl.failNext(1, "fetchTransactions");
      const res = await syncNow(a, consentId, new Date());
      expect(res.error).toBe("provider_error");
      const { AaConsent } = await models();
      expect((await AaConsent.findOne({ user: a }).lean<Json>())?.lastError).toBe("provider_error");
      const ok = await syncNow(a, consentId, new Date(Date.now() + 10 * 60 * 1000));
      expect(ok.error).toBeUndefined();
      expect(ok.created).toBe(3);
    });
  });

  describe("ending a consent", () => {
    it("revoke tells the provider, stops sync and keeps what was added", async () => {
      const { consentId } = await linked();
      await syncRoute(consentId);
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const handle = await handleOf(consentId);
      const res = await revoke(consentId);
      expect(res.status).toBe(200);
      const body = (await res.json()).data as Json;
      expect(body).toMatchObject({ providerRevoked: true, consent: { status: "revoked" } });
      expect(sandboxControl.isRevoked(handle)).toBe(true);

      const after = await syncRoute(consentId);
      expect(after.status).toBe(409);
      const { Transaction } = await models();
      expect(await Transaction.countDocuments({ user: a, source: "aa" })).toBe(3);

      // The timer ignores it too.
      const { syncAllConsents } = await import("@/lib/aa-service");
      expect((await syncAllConsents()).checked).toBe(0);
    });

    it("revoke when the provider does not confirm still stops sync and says so", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { revokeConsent } = await import("@/lib/aa-service");
      const providers = await import("@/lib/aa/providers");
      const provider = providers.getAaProvider()!;
      const spy = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new Error("boom"));
      const out = await revokeConsent(a, consentId);
      expect(out.providerRevoked).toBe(false);
      expect(out.consent.status).toBe("revoked");
      expect(out.consent.lastError).toBe("revoke_not_confirmed");
      spy.mockRestore();
      void sandboxControl;
    });

    it("revoking twice is fine", async () => {
      const { consentId } = await linked();
      expect((await revoke(consentId, KEY_A, { "idempotency-key": "r1" })).status).toBe(200);
      expect((await revoke(consentId, KEY_A, { "idempotency-key": "r2" })).status).toBe(200);
    });

    it("an expired consent is marked expired by the sync, with one notification", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { syncNow } = await import("@/lib/aa-service");
      sandboxControl.expire(await handleOf(consentId));
      const res = await syncNow(a, consentId, new Date());
      expect(res.status).toBe("expired");
      const { AaConsent, Notification, Transaction } = await models();
      expect((await AaConsent.findOne({ user: a }).lean<Json>())?.status).toBe("expired");
      expect(await Notification.countDocuments({ user: a, "meta.kind": "aa_consent" })).toBe(1);
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      // Not read again, no second notification.
      await expect(syncNow(a, consentId, new Date(Date.now() + 10 * 60 * 1000))).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(await Notification.countDocuments({ user: a, "meta.kind": "aa_consent" })).toBe(1);
    });

    it("a withdrawal at the provider is noticed on the next sync", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { syncNow } = await import("@/lib/aa-service");
      sandboxControl.setStatus(await handleOf(consentId), "revoked");
      const res = await syncNow(a, consentId, new Date());
      expect(res).toMatchObject({ status: "revoked", skipped: "not_active", created: 0 });
      const { AaConsent, Notification } = await models();
      const c = await AaConsent.findOne({ user: a }).lean<Json>();
      expect(c).toMatchObject({ status: "revoked", lastError: "revoked_at_provider" });
      expect(await Notification.countDocuments({ user: a, "meta.kind": "aa_consent" })).toBe(1);
    });

    it("the timer reads active consents once, skips recent ones and runs one sweep at a time", async () => {
      const { consentId } = await linked();
      const { syncAllConsents } = await import("@/lib/aa-service");
      const [one, two] = await Promise.all([syncAllConsents(), syncAllConsents()]);
      const ran = [one, two].filter((r) => !r.skipped);
      expect(ran).toHaveLength(1);
      expect(ran[0]).toMatchObject({ checked: 1, created: 3 });
      // Read less than an hour ago: not due.
      expect(await syncAllConsents()).toMatchObject({ checked: 0 });
      void consentId;
    });

    it("deleting the account's data withdraws the consents and removes the records", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { deleteAaDataForUser } = await import("@/lib/aa-service");
      const handle = await handleOf(consentId);
      await deleteAaDataForUser(a);
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({ user: a })).toBe(0);
      expect(sandboxControl.isRevoked(handle)).toBe(true);
    });
  });

  describe("isolation", () => {
    it("one person cannot see, refresh, map, sync or revoke another's consent", async () => {
      const { consentId, consent } = await linked();
      const theirs = await status(KEY_B);
      expect((await theirs.json()).data.consents).toEqual([]);
      expect((await refresh(consentId, KEY_B)).status).toBe(404);
      expect((await syncRoute(consentId, KEY_B)).status).toBe(404);
      expect((await revoke(consentId, KEY_B)).status).toBe(404);
      expect((await mapRoute(consentId, consent.linkedAccounts[0].id, null, KEY_B)).status).toBe(404);
      const { AaConsent } = await models();
      expect((await AaConsent.findOne({ user: a }).lean<Json>())?.status).toBe("active");
    });

    it("an invalid id is a 404, not an error", async () => {
      process.env.AA_PROVIDER = "sandbox";
      expect((await refresh("not-an-id")).status).toBe(404);
    });
  });

  describe("review fixes", () => {
    const actor = () => ({ id: a, name: "A", email: "a@x.com", role: "user" });
    const feed = (ref: string, list: Array<Partial<Json> & { id: string }>) =>
      list.map((t) => ({ accountRef: ref, type: "expense", amountMinor: 500, currency: "INR", at: new Date(), narration: "X", ...t }));

    it("revoke and mapping answer AA_NOT_CONFIGURED once the provider is unset", async () => {
      const { consentId, consent } = await linked();
      delete process.env.AA_PROVIDER;
      const r = await revoke(consentId);
      expect(r.status).toBe(503);
      expect((await r.json()).error.code).toBe("AA_NOT_CONFIGURED");
      const m = await mapRoute(consentId, consent.linkedAccounts[0].id, null);
      expect(m.status).toBe(503);
      const { AaConsent } = await models();
      expect((await AaConsent.findOne({ user: a }).lean<Json>())?.status).toBe("active");
    });

    it("two consents cannot both feed one account: auto-map and manual map are both refused", async () => {
      const { bank, consent, consentId: firstId } = await linked();
      expect(consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").mappedAccountId).toBe(String(bank._id));
      const second = (await (await create()).json()).data.consent as Json;
      const refreshed = (await (await refresh(second.id)).json()).data.consent as Json;
      const hdfc = refreshed.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      expect(hdfc.mappedAccountId).toBeNull();
      const clash = await mapRoute(second.id, hdfc.id, String(bank._id));
      expect(clash.status).toBe(409);
      // A revoked consent no longer holds the account.
      expect((await revoke(firstId)).status).toBe(200);
      expect((await mapRoute(second.id, hdfc.id, String(bank._id))).status).toBe(200);
    });

    it("refresh adds new linked accounts one at a time and keeps a mapping the person cleared", async () => {
      const { consentId, consent } = await linked();
      const hdfc = consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank");
      await mapRoute(consentId, hdfc.id, null);
      const again = (await (await refresh(consentId)).json()).data.consent as Json;
      expect(again.linkedAccounts).toHaveLength(2);
      expect(again.linkedAccounts.find((l: Json) => l.id === hdfc.id).mappedAccountId).toBeNull();
    });

    it("a historical bank entry confirmed from the review inbox leaves the balance alone, a new one moves it", async () => {
      const { consentId, bank } = await linked();
      const { Account, Transaction, CapturedMessage, Notification } = await models();
      const { ingestAaTransaction } = await import("@/lib/capture/ingest");
      const { resolveCapture } = await import("@/lib/reconcile/inbox");
      // The mapped account is archived behind the link's back: the entry cannot be placed and is queued.
      await Account.updateOne({ _id: bank._id }, { $set: { isArchived: true } });
      const old = await ingestAaTransaction({
        user: actor(), provider: "sandbox", providerTxnId: "h-1", accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
        type: "expense", amountMinor: 70000, at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), narration: "OLD", historical: true,
      });
      const fresh = await ingestAaTransaction({
        user: actor(), provider: "sandbox", providerTxnId: "h-2", accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
        type: "expense", amountMinor: 30000, at: new Date(), narration: "NEW", historical: false,
      });
      expect(old.body.status).toBe("queued");
      expect(fresh.body.status).toBe("queued");
      expect((await CapturedMessage.findById(old.body.captureId).lean<Json>())?.historical).toBe(true);
      const note = await Notification.findOne({ user: a }).lean<Json>();
      expect(note?.body).toMatch(/bank link/);
      expect(note?.body).not.toMatch(/digits/);

      const other = await Account.create({ user: a, name: "Other", type: "bank", balance: 50000 });
      const input = (amount: number) => ({ action: "create" as const, accountId: String(other._id), type: "expense" as const, amount, category: "other", rememberDigits: false });
      await resolveCapture({ userId: a, captureId: old.body.captureId, input: input(70000), actor: actor(), via: "mobile" });
      expect((await Account.findById(other._id).lean<Json>())?.balance).toBe(50000);
      await resolveCapture({ userId: a, captureId: fresh.body.captureId, input: input(30000), actor: actor(), via: "mobile" });
      expect((await Account.findById(other._id).lean<Json>())?.balance).toBe(20000);
      const row = await Transaction.findOne({ user: a, amount: 70000 }).lean<Json>();
      expect(row).toMatchObject({ source: "aa", reviewStatus: "confirmed" });
    });

    it("archiving a mapped account clears its mapping and the sync skips it", async () => {
      const { consentId, bank } = await linked();
      const { archiveAccount } = await import("@/lib/account-service");
      await archiveAccount(a, String(bank._id), actor());
      const view = ((await (await status()).json()).data.consents[0] as Json).linkedAccounts;
      expect(view.every((l: Json) => l.mappedAccountId === null)).toBe(true);
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ fetched: 0, created: 0, unmappedAccounts: 2 });
    });

    it("a mapping to an account archived behind the link's back is skipped by the sync", async () => {
      const { consentId, bank } = await linked();
      const { Account } = await models();
      await Account.updateOne({ _id: bank._id }, { $set: { isArchived: true } });
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ created: 0, unmappedAccounts: 2 });
    });

    it("finishes a capture a crash left in processing, once, and leaves a fresh one alone", async () => {
      const { bank } = await linked();
      const { Transaction, CapturedMessage } = await models();
      const { ingestAaTransaction } = await import("@/lib/capture/ingest");
      const input = {
        user: actor(), provider: "sandbox", providerTxnId: "crash-1", accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
        type: "expense" as const, amountMinor: 8800, at: new Date(), narration: "CRASH", historical: false,
      };
      expect((await ingestAaTransaction(input)).body.status).toBe("created");
      // Simulate the crash: the row exists as "processing" with no transaction.
      await Transaction.deleteMany({ user: a });
      await CapturedMessage.collection.updateOne({ user: new mongoose.Types.ObjectId(a), channel: "aa" }, { $set: { outcome: "processing", status: "pending" }, $unset: { transaction: "" } });
      // Fresh: another reader may still be on it.
      expect((await ingestAaTransaction(input)).body.status).toBe("duplicate");
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      // Stale: picked up.
      await CapturedMessage.collection.updateOne({ user: new mongoose.Types.ObjectId(a), channel: "aa" }, { $set: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } });
      const [one, two] = await Promise.all([ingestAaTransaction(input), ingestAaTransaction(input)]);
      expect([one.body.status, two.body.status].sort()).toEqual(["created", "duplicate"]);
      expect(await Transaction.countDocuments({ user: a })).toBe(1);
      expect((await CapturedMessage.findOne({ user: a, channel: "aa" }).lean<Json>())?.outcome).toBe("created");
    });

    it("a crash after the transaction was written does not book the payment twice on recovery", async () => {
      const { bank } = await linked();
      const { Transaction, CapturedMessage } = await models();
      const { ingestAaTransaction } = await import("@/lib/capture/ingest");
      const input = {
        user: actor(), provider: "sandbox", providerTxnId: "crash-2", accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
        type: "expense" as const, amountMinor: 4400, at: new Date(), narration: "CRASH2", historical: false,
      };
      await ingestAaTransaction(input);
      await CapturedMessage.collection.updateOne(
        { user: new mongoose.Types.ObjectId(a), channel: "aa" },
        { $set: { outcome: "processing", status: "pending", updatedAt: new Date(Date.now() - 60 * 60 * 1000) }, $unset: { transaction: "" } }
      );
      expect((await ingestAaTransaction(input)).body.status).toBe("duplicate");
      expect(await Transaction.countDocuments({ user: a })).toBe(1);
      expect((await CapturedMessage.findOne({ user: a, channel: "aa" }).lean<Json>())?.outcome).toBe("duplicate");
    });

    it("skips entries a provider returns for another linked account", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const ref = await providerRef(consentId, consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").id);
      sandboxControl.setTransactions(await handleOf(consentId), ref, [
        ...feed(ref, [{ id: "mine-1" }]),
        ...feed("some-other-account", [{ id: "theirs-1" }]),
      ] as never);
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync).toMatchObject({ created: 1, skippedInvalid: 1 });
    });

    it("a long run of skipped entries does not stall the link", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { SYNC_LIMITS, syncNow } = await import("@/lib/aa-service");
      const ref = await providerRef(consentId, consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").id);
      const t0 = Date.now() - 5 * 24 * 60 * 60 * 1000;
      const list = [
        ...[0, 1, 2, 3, 4].map((i) => ({ id: `usd-${i}`, currency: "USD", at: new Date(t0 + i * 60_000) })),
        { id: "inr-1", at: new Date(t0 + 10 * 60_000), narration: "REAL" },
      ];
      sandboxControl.setTransactions(await handleOf(consentId), ref, feed(ref, list) as never);
      const saved = { ...SYNC_LIMITS };
      SYNC_LIMITS.transactions = 3;
      try {
        let created = 0;
        let t = Date.now();
        for (let i = 0; i < 5 && created === 0; i += 1) {
          t += 10 * 60 * 1000;
          created += (await syncNow(a, consentId, new Date(t))).created;
        }
        expect(created).toBe(1);
      } finally {
        Object.assign(SYNC_LIMITS, saved);
      }
    });

    it("a second read at the same moment answers 429, and a failed read counts for the cooldown", async () => {
      const { consentId } = await linked();
      const { syncNow } = await import("@/lib/aa-service");
      const results = await Promise.allSettled([syncNow(a, consentId, new Date()), syncNow(a, consentId, new Date())]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "TOO_SOON" });
    });

    it("a provider failure sets lastSyncAt, so the next call is within the cooldown", async () => {
      const { consentId } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      sandboxControl.failNext(1, "consentStatus");
      const first = await syncRoute(consentId);
      expect((await first.json()).data.sync.error).toBe("provider_error");
      expect((await syncRoute(consentId)).status).toBe(429);
    });

    it("the cap holds when many consents start at once", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const out = await Promise.all(Array.from({ length: 9 }, (_, i) => create(KEY_A, { "idempotency-key": `race-${i}` })));
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({ user: a })).toBeLessThanOrEqual(5);
      for (const r of out.filter((x) => x.status !== 201)) expect(r.status).toBe(409);
      expect(out.some((r) => r.status === 201)).toBe(true);
    });

    it("rejects what a provider returns when it is not valid: http consent screen, unknown status, bad page", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const providers = await import("@/lib/aa/providers");
      const provider = providers.getAaProvider()!;
      const spy = vi.spyOn(provider, "createConsent").mockResolvedValueOnce({ handle: "h", redirectUrl: "http://evil.example/x", expiresAt: new Date(Date.now() + 1e9) });
      const bad = await create();
      expect(bad.status).toBe(502);
      const { AaConsent } = await models();
      expect(await AaConsent.countDocuments({})).toBe(0);
      spy.mockRestore();

      const { consentId } = await linked();
      const st = vi.spyOn(provider, "consentStatus").mockResolvedValueOnce({ status: "weird", accounts: [] } as never);
      expect((await refresh(consentId)).status).toBe(502);
      st.mockRestore();
      const ft = vi.spyOn(provider, "fetchTransactions").mockResolvedValueOnce({ transactions: "nope" } as never);
      const sync = (await (await syncRoute(consentId)).json()).data.sync as Json;
      expect(sync.error).toBe("provider_error");
      ft.mockRestore();
    });

    it("the sweep stops starting consents past its time budget and leaves the rest for the next run", async () => {
      await linked();
      const { syncAllConsents, SWEEP_LIMITS } = await import("@/lib/aa-service");
      const saved = SWEEP_LIMITS.budgetMs;
      SWEEP_LIMITS.budgetMs = -1;
      try {
        expect(await syncAllConsents()).toMatchObject({ checked: 0, partial: true });
      } finally {
        SWEEP_LIMITS.budgetMs = saved;
      }
      expect(await syncAllConsents()).toMatchObject({ checked: 1 });
    });
  });

  describe("second review fixes", () => {
    const actor = () => ({ id: a, name: "A", email: "a@x.com", role: "user" });
    const feed = (ref: string, list: Array<Partial<Json> & { id: string }>) =>
      list.map((t) => ({ accountRef: ref, type: "expense", amountMinor: 500, currency: "INR", at: new Date(), narration: "X", ...t }));

    /** Two approved consents whose HDFC accounts are unmapped because the user's account has no digits saved. */
    async function twoUnmapped() {
      process.env.AA_PROVIDER = "sandbox";
      const { Account } = await models();
      const bank = await Account.create({ user: a, name: "Savings", type: "bank", balance: 100000 });
      const out: Array<{ id: string; hdfc: string }> = [];
      for (let i = 0; i < 2; i += 1) {
        const made = (await (await create(KEY_A, { "idempotency-key": `two-${i}` })).json()).data.consent as Json;
        const r = (await (await refresh(made.id)).json()).data.consent as Json;
        out.push({ id: made.id, hdfc: r.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").id });
      }
      return { bank, a: out[0], b: out[1] };
    }

    it("exactly one of two concurrent mappings of one account across consents wins", async () => {
      const { bank, a: c1, b: c2 } = await twoUnmapped();
      const results = await Promise.all([mapRoute(c1.id, c1.hdfc, String(bank._id)), mapRoute(c2.id, c2.hdfc, String(bank._id))]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const { AaAccountClaim } = await import("@/models/AaAccountClaim").then((m) => ({ AaAccountClaim: m.default as mongoose.Model<Json> }));
      expect(await AaAccountClaim.countDocuments({ user: a, account: bank._id })).toBe(1);
      // Unmapping releases it for the other consent.
      const winner = results[0].status === 200 ? c1 : c2;
      const loser = winner === c1 ? c2 : c1;
      expect((await mapRoute(winner.id, winner.hdfc, null)).status).toBe(200);
      expect((await mapRoute(loser.id, loser.hdfc, String(bank._id))).status).toBe(200);
    });

    it("concurrent refreshes of two consents auto-map one account into only one", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const { Account } = await models();
      await Account.create({ user: a, name: "HDFC Savings", type: "bank", balance: 1, smsLastFour: ["1234"] });
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      sandboxControl.setAutoApprove(false);
      const ids: string[] = [];
      for (let i = 0; i < 2; i += 1) ids.push(((await (await create(KEY_A, { "idempotency-key": `ar-${i}` })).json()).data.consent as Json).id);
      sandboxControl.setAutoApprove(true);
      const out = await Promise.all(ids.map((id) => refresh(id)));
      const mapped = (await Promise.all(out.map(async (r) => ((await r.json()).data.consent as Json).linkedAccounts)))
        .flat()
        .filter((l: Json) => l.mappedAccountId);
      expect(mapped).toHaveLength(1);
    });

    it("a history row never moves the balance when it is deleted, voided or corrected", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { ingestAaTransaction } = await import("@/lib/capture/ingest");
      const { deleteTransaction } = await import("@/lib/transaction-service");
      const { correctTransaction } = await import("@/lib/reconcile/correct");
      const mk = async (id: string, amount: number) => {
        const r = await ingestAaTransaction({
          user: actor(), provider: "sandbox", providerTxnId: id, accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
          type: "expense", amountMinor: amount, at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), narration: id, historical: true,
        });
        return r.body.transactionId as string;
      };
      const balance = async () => (await Account.findById(bank._id).lean<Json>())?.balance;
      const t1 = await mk("hist-1", 1111);
      const t2 = await mk("hist-2", 2222);
      const t3 = await mk("hist-3", 3333);
      expect((await Transaction.findById(t1).lean<Json>())?.balanceApplied).toBe(false);
      expect(await balance()).toBe(100000);
      await deleteTransaction(a, t1, actor());
      expect(await balance()).toBe(100000);
      await correctTransaction({ userId: a, transactionId: t2, changes: { amount: 9999 }, reason: "wrong_amount" as never, via: "mobile", actor: actor() });
      expect(await balance()).toBe(100000);
      await correctTransaction({ userId: a, transactionId: t3, changes: {}, reason: "not_a_transaction", via: "mobile", actor: actor() });
      expect(await balance()).toBe(100000);
      // A normal row still moves it, both ways.
      const live = await ingestAaTransaction({
        user: actor(), provider: "sandbox", providerTxnId: "live-1", accountId: String(bank._id), bankName: "HDFC Bank", last4: "1234",
        type: "expense", amountMinor: 4000, at: new Date(), narration: "live", historical: false,
      });
      expect(await balance()).toBe(96000);
      await deleteTransaction(a, live.body.transactionId as string, actor());
      expect(await balance()).toBe(100000);
    });

    it("a transfer written as history leaves both accounts alone", async () => {
      const { bank } = await linked();
      const { Account } = await models();
      const cash = await Account.create({ user: a, name: "Cash", type: "cash", balance: 2000 });
      const { createTransaction } = await import("@/lib/transaction-service");
      await createTransaction({
        userId: a, actor: actor(), accountId: String(bank._id), transferToId: String(cash._id), type: "transfer", amount: 3000, category: "Transfer",
        date: new Date().toISOString(), tags: [], isRecurring: false, skipBalance: true, provenance: { source: "aa", historical: true },
      } as never);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect((await Account.findById(cash._id).lean<Json>())?.balance).toBe(2000);
    });

    it("a failed create leaves the balance alone and a retry applies it once", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const input = { userId: a, actor: actor(), accountId: String(bank._id), type: "expense" as const, amount: 5000, category: "food", date: new Date().toISOString(), tags: [], isRecurring: false };
      const spy = vi.spyOn(Transaction, "create").mockRejectedValueOnce(new Error("boom") as never);
      await expect(createTransaction(input as never)).rejects.toThrow("boom");
      spy.mockRestore();
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      await createTransaction(input as never);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(95000);
      expect(await Transaction.countDocuments({ user: a })).toBe(1);
    });

    it("a ledger failure after the commit is logged, not an error, so a retry cannot book the payment twice", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const LedgerBlock = (await import("@/models/LedgerBlock")).default as mongoose.Model<Json>;
      const input = { userId: a, actor: actor(), accountId: String(bank._id), type: "expense" as const, amount: 5000, category: "food", date: new Date().toISOString(), tags: [], isRecurring: false };
      const spy = vi.spyOn(LedgerBlock, "create").mockRejectedValue(new Error("ledger down") as never);
      try {
        const out = await createTransaction(input as never);
        expect(out.kind).toBe("single");
      } finally {
        spy.mockRestore();
      }
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(95000);
      expect(await Transaction.countDocuments({ user: a })).toBe(1);
    });

    it("creates at the same moment on one account all apply (write conflicts are retried)", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const make = (i: number) =>
        createTransaction({ userId: a, actor: actor(), accountId: String(bank._id), type: "expense", amount: 100 + i, category: "food", date: new Date().toISOString(), tags: [], isRecurring: false } as never);
      await Promise.all(Array.from({ length: 8 }, (_, i) => make(i)));
      const total = Array.from({ length: 8 }, (_, i) => 100 + i).reduce((x, y) => x + y, 0);
      expect(await Transaction.countDocuments({ user: a })).toBe(8);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000 - total);
    });

    it("a transfer into an archived destination is refused and books nothing", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const cash = await Account.create({ user: a, name: "Cash", type: "cash", balance: 2000 });
      const { createTransaction } = await import("@/lib/transaction-service");
      await Account.updateOne({ _id: cash._id }, { $set: { isArchived: true } });
      await expect(
        createTransaction({ userId: a, actor: actor(), accountId: String(bank._id), transferToId: String(cash._id), type: "transfer", amount: 900, category: "Transfer", date: new Date().toISOString(), tags: [], isRecurring: false } as never)
      ).rejects.toThrow();
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
    });

    it("a claim that keeps vanishing ends as not claimed after a few attempts", async () => {
      const { consentId, consent } = await linked();
      const { Account } = await models();
      const other = await Account.create({ user: a, name: "Other", type: "bank", balance: 0 });
      const Claim = (await import("@/models/AaAccountClaim")).default as mongoose.Model<Json>;
      const create = vi.spyOn(Claim, "create").mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }) as never);
      const find = vi.spyOn(Claim, "findOne").mockReturnValue({ lean: async () => null } as never);
      try {
        const axis = consent.linkedAccounts.find((l: Json) => l.bankName === "Axis Bank");
        const res = await mapRoute(consentId, axis.id, String(other._id));
        expect(res.status).toBe(409);
        expect(create).toHaveBeenCalledTimes(5);
      } finally {
        create.mockRestore();
        find.mockRestore();
      }
    });

    it("an account archived between the read and the write rolls the create back (source and transfer destination)", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const cash = await Account.create({ user: a, name: "Cash", type: "cash", balance: 2000 });
      const { createTransaction } = await import("@/lib/transaction-service");
      const base = { userId: a, actor: actor(), date: new Date().toISOString(), tags: [], isRecurring: false };
      const orig = Transaction.create.bind(Transaction);
      const archiveThen = (accountId: unknown) =>
        vi.spyOn(Transaction, "create").mockImplementationOnce((async (...args: unknown[]) => {
          await Account.updateOne({ _id: accountId }, { $set: { isArchived: true } });
          return (orig as (...a: unknown[]) => unknown)(...args);
        }) as never);

      // The source account is archived inside the window.
      let spy = archiveThen(bank._id);
      await expect(createTransaction({ ...base, accountId: String(bank._id), type: "expense", amount: 700, category: "food" } as never)).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      spy.mockRestore();
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      await Account.updateOne({ _id: bank._id }, { $set: { isArchived: false } });

      // The transfer destination is archived inside the window.
      spy = archiveThen(cash._id);
      await expect(
        createTransaction({ ...base, accountId: String(bank._id), transferToId: String(cash._id), type: "transfer", amount: 900, category: "Transfer" } as never)
      ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_NOT_FOUND" });
      spy.mockRestore();
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect((await Account.findById(cash._id).lean<Json>())?.balance).toBe(2000);
    });

    it("a recurring series is still created when a ledger block fails after the commit", async () => {
      const { bank } = await linked();
      const { Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const LedgerBlock = (await import("@/models/LedgerBlock")).default as mongoose.Model<Json>;
      const spy = vi.spyOn(LedgerBlock, "create").mockRejectedValue(new Error("ledger down") as never);
      try {
        const out = await createTransaction({
          userId: a, actor: actor(), accountId: String(bank._id), type: "expense", amount: 300, category: "bills", date: new Date().toISOString(), tags: [],
          isRecurring: true, recurrenceFrequency: "monthly", recurrenceCount: 3,
        } as never);
        expect(out.kind).toBe("series");
      } finally {
        spy.mockRestore();
      }
      expect(await Transaction.countDocuments({ user: a, isRecurring: true })).toBe(3);
    });

    describe("consents of a deleted account", () => {
      it("a leftover consent is kept and flagged, a withdrawn one and one with no provider are deleted, and none is visible", async () => {
        const live = await linked();
        const done = await linked();
        const { AaConsent } = await models();
        const { purgeAaRecordsOfDeletedUser } = await import("@/lib/aa-service");
        await revoke(done.consentId);
        const orphan = (await (await create(KEY_A, { "idempotency-key": "orphan" })).json()).data.consent as Json;
        await AaConsent.updateOne({ _id: orphan.id }, { $set: { provider: "retired" } });
        const errSpy = vi.spyOn((await import("@/lib/logger")).default, "error");
        expect(await purgeAaRecordsOfDeletedUser(a)).toBe(1);
        const calls = errSpy.mock.calls;
        errSpy.mockRestore();
        const rows = await AaConsent.find({ user: a }).lean<Json[]>();
        expect(rows.map((r) => String(r._id))).toEqual([live.consentId]);
        expect(rows[0].ownerDeleted).toBe(true);
        expect(rows[0].consentHandle?.ciphertext).toBeTruthy();
        for (const c of calls) {
          expect(JSON.stringify(c[0])).not.toContain(a);
          expect(c[0]).toMatchObject({ correlationId: expect.stringMatching(/^[0-9a-f]{32}$/) });
        }
        // Nothing reaches it from a user route.
        expect((await (await status()).json()).data.consents).toEqual([]);
        expect((await refresh(live.consentId)).status).toBe(404);
        expect((await syncRoute(live.consentId)).status).toBe(404);
        expect((await revoke(live.consentId)).status).toBe(404);
      });

      it("the sweep never reads its transactions, retries the withdrawal, keeps it while that fails and deletes it once confirmed", async () => {
        const { consentId } = await linked();
        const { AaConsent, Transaction } = await models();
        const { purgeAaRecordsOfDeletedUser, syncAllConsents } = await import("@/lib/aa-service");
        const { sandboxControl } = await import("@/lib/aa/sandbox");
        const provider = (await import("@/lib/aa/providers")).getAaProvider()!;
        const handle = await handleOf(consentId);
        await purgeAaRecordsOfDeletedUser(a);

        const fetchSpy = vi.spyOn(provider, "fetchTransactions");
        const fail = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new Error("down") as never);
        await syncAllConsents();
        expect(await AaConsent.countDocuments({ _id: consentId, ownerDeleted: true })).toBe(1);
        expect(sandboxControl.isRevoked(handle)).toBe(false);
        fail.mockRestore();

        const out = await syncAllConsents();
        expect(out).toMatchObject({ checked: 0, created: 0 });
        expect(await AaConsent.countDocuments({ _id: consentId })).toBe(0);
        expect(sandboxControl.isRevoked(handle)).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        expect(await Transaction.countDocuments({ user: a })).toBe(0);
      });

      it("a provider that no longer knows the consent counts as withdrawn", async () => {
        const { consentId } = await linked();
        const { AaConsent } = await models();
        const { purgeAaRecordsOfDeletedUser, retryOwnerDeletedConsents } = await import("@/lib/aa-service");
        const { AaProviderError } = await import("@/lib/aa/provider");
        const provider = (await import("@/lib/aa/providers")).getAaProvider()!;
        await purgeAaRecordsOfDeletedUser(a);
        const spy = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new AaProviderError("CONSENT_NOT_FOUND") as never);
        expect(await retryOwnerDeletedConsents()).toEqual({ withdrawn: 1, kept: 0 });
        spy.mockRestore();
        expect(await AaConsent.countDocuments({ _id: consentId })).toBe(0);
      });
    });

    it("a failed split create leaves no rows and no balance move", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const input = {
        userId: a, actor: actor(), accountId: String(bank._id), type: "expense" as const, amount: 5000, category: "food", date: new Date().toISOString(), tags: [], isRecurring: false,
        splits: [{ category: "food", amount: 2000 }, { category: "fuel", amount: 3000 }],
      };
      const spy = vi.spyOn(Transaction, "insertMany").mockRejectedValueOnce(new Error("boom") as never);
      await expect(createTransaction(input as never)).rejects.toThrow("boom");
      spy.mockRestore();
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
      await createTransaction(input as never);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(95000);
      expect(await Transaction.countDocuments({ user: a })).toBe(2);
    });

    it("editing a transfer written as history leaves both balances alone", async () => {
      const { bank } = await linked();
      const { Account } = await models();
      const cash = await Account.create({ user: a, name: "Cash", type: "cash", balance: 2000 });
      const { createTransaction } = await import("@/lib/transaction-service");
      const { updateTransfer } = await import("@/lib/transfer-service");
      const made = await createTransaction({
        userId: a, actor: actor(), accountId: String(bank._id), transferToId: String(cash._id), type: "transfer", amount: 3000, category: "Transfer",
        date: new Date().toISOString(), tags: [], isRecurring: false, skipBalance: true, provenance: { source: "aa", historical: true },
      } as never);
      const id = String((made as Json).transaction._id);
      await updateTransfer({ userId: a, transferId: id, amount: 4500, actor: actor() } as never);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect((await Account.findById(cash._id).lean<Json>())?.balance).toBe(2000);
    });

    it("lines cloned from a history row by a split edit are history too, so deleting one leaves the balance", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction, deleteTransaction } = await import("@/lib/transaction-service");
      const { replaceSplits } = await import("@/lib/split-service");
      const made = await createTransaction({
        userId: a, actor: actor(), accountId: String(bank._id), type: "expense", amount: 6000, category: "food",
        date: new Date().toISOString(), tags: [], isRecurring: false, skipBalance: true, provenance: { source: "aa", historical: true, reviewStatus: null },
      } as never);
      const id = String((made as Json).transaction._id);
      await replaceSplits({ userId: a, transactionId: id, splits: [{ category: "food", amount: 2000 }, { category: "fuel", amount: 4000 }], actor: actor() });
      const rows = await Transaction.find({ user: a }).lean<Json[]>();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.balanceApplied === false)).toBe(true);
      await deleteTransaction(a, String(rows[1]._id), actor());
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
    });

    it("a failure after the row was written leaves neither the row nor a balance move", async () => {
      const { bank } = await linked();
      const { Account, Transaction } = await models();
      const { createTransaction } = await import("@/lib/transaction-service");
      const input = { userId: a, actor: actor(), accountId: String(bank._id), type: "expense" as const, amount: 5000, category: "food", date: new Date().toISOString(), tags: [], isRecurring: false };
      const spy = vi.spyOn(Account, "findOneAndUpdate").mockRejectedValueOnce(new Error("inc failed") as never);
      await expect(createTransaction(input as never)).rejects.toThrow("inc failed");
      spy.mockRestore();
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
      expect(await Transaction.countDocuments({ user: a })).toBe(0);
    });

    it("invalid and far-dated rows do not stall the link, and out-of-range dates are refused", async () => {
      const { consentId, consent } = await linked();
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const { SYNC_LIMITS, syncNow } = await import("@/lib/aa-service");
      const ref = await providerRef(consentId, consent.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").id);
      const t0 = Date.now() - 5 * 24 * 60 * 60 * 1000;
      const list = [
        ...[0, 1, 2, 3, 4].map((i) => ({ id: `bad-${i}`, amountMinor: -1, at: new Date(t0 + i * 60_000) })),
        { id: "future-1", at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
        { id: "ok-1", at: new Date(t0 + 10 * 60_000), narration: "REAL" },
      ];
      sandboxControl.setTransactions(await handleOf(consentId), ref, feed(ref, list) as never);
      const saved = { ...SYNC_LIMITS };
      SYNC_LIMITS.transactions = 3;
      try {
        let created = 0;
        let invalid = 0;
        let t = Date.now();
        for (let i = 0; i < 6; i += 1) {
          t += 10 * 60 * 1000;
          const r = await syncNow(a, consentId, new Date(t));
          created += r.created;
          invalid += r.skippedInvalid;
        }
        expect(created).toBe(1);
        expect(invalid).toBeGreaterThanOrEqual(6);
      } finally {
        Object.assign(SYNC_LIMITS, saved);
      }
      const { Transaction } = await models();
      expect(await Transaction.countDocuments({ user: a, description: /^(bad|future)/ })).toBe(0);
    });

    it("entries before the person approved the link are history, not only those before it was created", async () => {
      process.env.AA_PROVIDER = "sandbox";
      const { Account, Transaction } = await models();
      const bank = await Account.create({ user: a, name: "HDFC Savings", type: "bank", balance: 100000, smsLastFour: ["1234"] });
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      sandboxControl.setAutoApprove(false);
      const made = (await (await create()).json()).data.consent as Json;
      const entryAt = new Date();
      await new Promise((r) => setTimeout(r, 25));
      sandboxControl.setAutoApprove(true);
      const refreshed = (await (await refresh(made.id)).json()).data.consent as Json;
      const ref = await providerRef(made.id, refreshed.linkedAccounts.find((l: Json) => l.bankName === "HDFC Bank").id);
      sandboxControl.setTransactions(await handleOf(made.id), ref, feed(ref, [{ id: "between-1", at: entryAt, amountMinor: 6000 }]) as never);
      await syncRoute(made.id);
      const row = await Transaction.findOne({ user: a, amount: 6000 }).lean<Json>();
      expect(row?.balanceApplied).toBe(false);
      expect((await Account.findById(bank._id).lean<Json>())?.balance).toBe(100000);
    });

    it("account deletion: a consent with no registered provider is deleted locally and logged, so the person is not stuck", async () => {
      await linked();
      const { deleteAaDataForUser } = await import("@/lib/aa-service");
      const { AaConsent } = await models();
      await AaConsent.updateOne({ user: a }, { $set: { provider: "retired" } });
      const warn = vi.spyOn((await import("@/lib/logger")).default, "warn");
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 0 });
      expect(await AaConsent.countDocuments({ user: a })).toBe(0);
      const call = warn.mock.calls.find((c) => /may still be live/.test(String(c[1])));
      warn.mockRestore();
      expect(call?.[0]).toMatchObject({ provider: "retired", correlationId: expect.stringMatching(/^[0-9a-f]{32}$/) });
      expect(JSON.stringify(call?.[0])).not.toContain(a);
    });

    it("account deletion: a registered provider that fails to withdraw keeps the record and is counted", async () => {
      const { consentId } = await linked();
      const { deleteAaDataForUser } = await import("@/lib/aa-service");
      const provider = (await import("@/lib/aa/providers")).getAaProvider()!;
      const { AaConsent } = await models();
      const spy = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new Error("down") as never);
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 1 });
      expect(await AaConsent.countDocuments({ user: a })).toBe(1);
      spy.mockRestore();
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 0 });
      expect(await AaConsent.countDocuments({ user: a })).toBe(0);
      void consentId;
    });

    it("account deletion: a revoke the provider never confirmed is tried again, and a consent the provider forgot counts as withdrawn", async () => {
      const { consentId } = await linked();
      const { deleteAaDataForUser } = await import("@/lib/aa-service");
      const { sandboxControl } = await import("@/lib/aa/sandbox");
      const provider = (await import("@/lib/aa/providers")).getAaProvider()!;
      const { AaConsent } = await models();
      // Revoked locally, but the provider never confirmed it.
      const bad = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new Error("down") as never);
      await revoke(consentId);
      bad.mockRestore();
      expect((await AaConsent.findOne({ user: a }).lean<Json>())).toMatchObject({ status: "revoked", lastError: "revoke_not_confirmed" });
      const again = vi.spyOn(provider, "revoke");
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 0 });
      expect(again).toHaveBeenCalledTimes(1);
      again.mockRestore();
      expect(await AaConsent.countDocuments({ user: a })).toBe(0);

      // Still failing: kept. Provider forgot it: done.
      const second = await linked(a);
      void second;
      await AaConsent.updateOne({ user: a }, { $set: { status: "revoked", lastError: "revoke_not_confirmed" } });
      const fail = vi.spyOn(provider, "revoke").mockRejectedValueOnce(new Error("down") as never);
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 1 });
      const { AaProviderError } = await import("@/lib/aa/provider");
      fail.mockRejectedValueOnce(new AaProviderError("CONSENT_NOT_FOUND") as never);
      expect(await deleteAaDataForUser(a)).toEqual({ remaining: 0 });
      fail.mockRestore();
      void sandboxControl;
    });

    it("refuses the sandbox in production unless it is allowed on purpose", async () => {
      process.env.AA_PROVIDER = "sandbox";
      vi.stubEnv("NODE_ENV", "production");
      try {
        expect((await (await status()).json()).data.configured).toBe(false);
        expect((await create()).status).toBe(503);
        vi.stubEnv("AA_ALLOW_SANDBOX", "true");
        expect((await (await status()).json()).data.configured).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("a provider call that does not answer in time is a provider error, and the run stops before another page when out of time", async () => {
      const { consentId } = await linked();
      const providers = await import("@/lib/aa/providers");
      const { PROVIDER_TIMEOUT, SYNC_LIMITS, syncNow } = await import("@/lib/aa-service");
      const provider = providers.getAaProvider()!;
      const spy = vi.spyOn(provider, "fetchTransactions").mockImplementation(() => new Promise(() => undefined));
      const savedMs = PROVIDER_TIMEOUT.ms;
      PROVIDER_TIMEOUT.ms = 30;
      try {
        expect((await syncNow(a, consentId, new Date())).error).toBe("provider_error");
      } finally {
        PROVIDER_TIMEOUT.ms = savedMs;
      }
      spy.mockClear();
      const savedBudget = SYNC_LIMITS.budgetMs;
      SYNC_LIMITS.budgetMs = -1;
      try {
        const out = await syncNow(a, consentId, new Date(Date.now() + 10 * 60 * 1000));
        expect(out.partial).toBe(true);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        SYNC_LIMITS.budgetMs = savedBudget;
        spy.mockRestore();
      }
    });
  });

  // Helpers that read what the app never sees: the provider's handle and a linked account's reference.
  async function handleOf(consentId: string) {
    const { AaConsent } = await models();
    const { decryptField } = await import("@/lib/crypto");
    const c = await AaConsent.findById(consentId).lean<Json>();
    return decryptField(c!.consentHandle, "CAPTURE_ENCRYPTION_KEY");
  }
  async function providerRef(consentId: string, linkedId: string) {
    const { AaConsent } = await models();
    const c = await AaConsent.findById(consentId).lean<Json>();
    return c!.linkedAccounts.find((l: Json) => l._id.toString() === linkedId).providerRef as string;
  }
});
