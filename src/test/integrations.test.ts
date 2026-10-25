import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

// Redis is optional in this app (returns null when REDIS_URL is unset) — the
// suite exercises that same "Redis unavailable" code path everywhere rather
// than standing up a real Redis instance.
vi.mock("@/lib/redis", () => ({ redis: null }));

// Session auth for the /api/me/* route suites. Each test sets
// `sessionUser.current` to act as a signed-in user (or null for signed out).
const sessionUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }));
vi.mock("@/lib/auth-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAuth: async () =>
      sessionUser.current
        ? { user: sessionUser.current }
        : { errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  };
});

// All test-related code (setup + every suite) lives in this single file by
// design, rather than a separate setup.ts + one file per module.

// Raw captured SMS text is encrypted at rest (src/lib/crypto.ts).
process.env.CAPTURE_ENCRYPTION_KEY = "test-capture-encryption-key-at-least-32-chars";

// A one-node replica set, like production (realtime needs one): split edits use a database transaction.
let mongod: MongoMemoryReplSet;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // Set before any test imports/calls connectDB() (src/lib/mongodb.ts), which
  // lazily connects using this env var and caches the connection globally.
  process.env.MONGODB_URI = mongod.getUri();
  // Establish the connection now via the app's own connectDB() (not a raw
  // mongoose.connect) so its internal cache reflects an already-open
  // connection — otherwise the first test to call a bare Model.create()
  // fixture helper (before any app code has called connectDB()) hits
  // mongoose's query buffering timeout instead of actually connecting.
  const { default: connectDB } = await import("@/lib/mongodb");
  await connectDB();
});

afterEach(async () => {
  // Per-process caches outlive the per-test DB wipe; start each test cold.
  const { resetAuthCacheForTests } = await import("@/lib/integrations/auth");
  const { resetRateLimitWindowsForTests } = await import("@/lib/integrations/rate-limit");
  const { forgetAllSessionsForTests } = await import("@/lib/perf/session-cache");
  resetAuthCacheForTests();
  resetRateLimitWindowsForTests();
  forgetAllSessionsForTests();
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ── src/lib/transaction-service.ts ─────────────────────────────────────────

describe("createTransaction", () => {
  async function makeUserAndAccount(balance = 10000) {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "Test", email: `t${Date.now()}${Math.random()}@x.com`, password: "hash" });
    const account = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance, currency: "INR" });
    const actor = { id: user._id.toString(), name: user.name, email: user.email, role: "user" };
    return { user, account, actor };
  }

  it("updates account balance for an expense and appends ledger blocks", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Account } = await import("@/models/Account");
    const { default: LedgerBlock } = await import("@/models/LedgerBlock");
    const { account, actor } = await makeUserAndAccount(10000);

    const result = await createTransaction({
      userId: actor.id,
      actor,
      accountId: account._id.toString(),
      type: "expense",
      amount: 2500,
      currency: "INR",
      category: "Food",
      tags: [],
      isRecurring: false,
      date: new Date().toISOString(),
    });

    expect(result.kind).toBe("single");
    const updated = await Account.findById(account._id);
    expect(updated!.balance).toBe(7500);

    const blocks = await LedgerBlock.find({ user: actor.id });
    expect(blocks.length).toBeGreaterThanOrEqual(2); // account update + transaction create
  });

  it("updates account balance for income (increase)", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Account } = await import("@/models/Account");
    const { account, actor } = await makeUserAndAccount(1000);

    await createTransaction({
      userId: actor.id,
      actor,
      accountId: account._id.toString(),
      type: "income",
      amount: 5000,
      currency: "INR",
      category: "Salary",
      tags: [],
      isRecurring: false,
      date: new Date().toISOString(),
    });

    const updated = await Account.findById(account._id);
    expect(updated!.balance).toBe(6000);
  });

  it("moves balance both ways for a transfer", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Account } = await import("@/models/Account");
    const { account, actor, user } = await makeUserAndAccount(10000);
    const dest = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 0, currency: "INR" });

    await createTransaction({
      userId: actor.id,
      actor,
      accountId: account._id.toString(),
      transferToId: dest._id.toString(),
      type: "transfer",
      amount: 3000,
      currency: "INR",
      category: "Transfer",
      tags: [],
      isRecurring: false,
      date: new Date().toISOString(),
    });

    expect((await Account.findById(account._id))!.balance).toBe(7000);
    expect((await Account.findById(dest._id))!.balance).toBe(3000);
  });

  it("throws ACCOUNT_NOT_FOUND for a nonexistent source account", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { actor } = await makeUserAndAccount();

    await expect(
      createTransaction({
        userId: actor.id,
        actor,
        accountId: "64f000000000000000000000",
        type: "expense",
        amount: 100,
        currency: "INR",
        category: "Food",
        tags: [],
        isRecurring: false,
        date: new Date().toISOString(),
      })
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });

  it("throws TRANSFER_ACCOUNT_NOT_FOUND for a nonexistent destination", async () => {
    const { createTransaction, TransactionServiceError } = await import("@/lib/transaction-service");
    const { account, actor } = await makeUserAndAccount();

    await expect(
      createTransaction({
        userId: actor.id,
        actor,
        accountId: account._id.toString(),
        transferToId: "64f000000000000000000000",
        type: "transfer",
        amount: 100,
        currency: "INR",
        category: "Transfer",
        tags: [],
        isRecurring: false,
        date: new Date().toISOString(),
      })
    ).rejects.toBeInstanceOf(TransactionServiceError);
  });

  it("materializes a recurring series without touching balance", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { account, actor } = await makeUserAndAccount(5000);

    const result = await createTransaction({
      userId: actor.id,
      actor,
      accountId: account._id.toString(),
      type: "expense",
      amount: 100,
      currency: "INR",
      category: "Subscription",
      tags: [],
      isRecurring: true,
      recurrenceFrequency: "monthly",
      recurrenceInterval: 1,
      recurrenceCount: 3,
      date: new Date().toISOString(),
    });

    expect(result.kind).toBe("series");
    if (result.kind === "series") expect(result.count).toBe(3);

    const unchanged = await Account.findById(account._id);
    expect(unchanged!.balance).toBe(5000);

    const installments = await Transaction.find({ user: actor.id });
    expect(installments.length).toBe(3);
    expect(installments.every((t) => t.installmentStatus === "upcoming")).toBe(true);
  });
});

// ── src/lib/integrations/auth.ts ───────────────────────────────────────────

describe("verifyN8nAuth", () => {
  const TEST_KEY = "test-n8n-api-key-value";
  const TEST_EMAIL = "n8n-user@example.com";

  function makeReq(headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/integrations/accounts", { headers });
  }

  beforeEach(async () => {
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "N8N User", email: TEST_EMAIL, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "test", keyHash: hashKey(TEST_KEY), lastFour: TEST_KEY.slice(-4) });
  });

  it("rejects a missing Authorization header", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const result = await verifyN8nAuth(makeReq(), "req-1");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const result = await verifyN8nAuth(makeReq({ authorization: `Token ${TEST_KEY}` }), "req-2");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });

  it("rejects an invalid API key", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const result = await verifyN8nAuth(makeReq({ authorization: "Bearer wrong-key" }), "req-3");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });

  it("accepts a valid API key and resolves the configured user", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-4");
    expect("user" in result).toBe(true);
    if ("user" in result) expect(result.user.email).toBe(TEST_EMAIL);
  });

  it("rejects a revoked key", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const { default: ApiKey } = await import("@/models/ApiKey");
    await ApiKey.updateMany({}, { $set: { revoked: true, revokedAt: new Date() } });
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-6");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });

  it("rejects an expired key", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const { default: ApiKey } = await import("@/models/ApiKey");
    await ApiKey.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-7");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });

  it("accepts a key whose expiry is in the future", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const { default: ApiKey } = await import("@/models/ApiKey");
    await ApiKey.updateMany({}, { $set: { expiresAt: new Date(Date.now() + 60_000) } });
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-8");
    expect("user" in result).toBe(true);
  });

  it("does not count successful requests toward the failed-auth IP limit", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    for (let i = 0; i < 15; i++) {
      const ok = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), `req-ok-${i}`);
      expect("user" in ok).toBe(true);
    }
  });

  it("locks an IP out after 10 failed attempts, with a Retry-After header", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    for (let i = 0; i < 10; i++) {
      await verifyN8nAuth(makeReq({ authorization: "Bearer wrong", "x-forwarded-for": "9.9.9.9" }), `req-bad-${i}`);
    }
    const locked = await verifyN8nAuth(
      makeReq({ authorization: `Bearer ${TEST_KEY}`, "x-forwarded-for": "9.9.9.9" }),
      "req-locked"
    );
    expect("errorResponse" in locked).toBe(true);
    if ("errorResponse" in locked) {
      expect(locked.errorResponse.status).toBe(429);
      expect(Number(locked.errorResponse.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    const otherIp = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}`, "x-forwarded-for": "1.1.1.1" }), "req-other");
    expect("user" in otherIp).toBe(true);
  });

  it("rejects a valid key when the configured user is missing", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const { default: User } = await import("@/models/User");
    await User.deleteMany({});
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-5");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
  });
});

// ── src/app/api/me/api-keys ────────────────────────────────────────────────

describe("/api/me/api-keys", () => {
  const PASSWORD = "correct-horse-battery";

  async function signIn(email = `k${Date.now()}${Math.random()}@x.com`) {
    const { default: User } = await import("@/models/User");
    const { hashPassword } = await import("@/utils/password");
    const user = await User.create({ name: "Key User", email, password: await hashPassword(PASSWORD), isActive: true });
    sessionUser.current = { id: user._id.toString(), name: user.name, email: user.email, role: "user" };
    return user;
  }

  function postReq(body: unknown) {
    return new NextRequest("http://localhost/api/me/api-keys", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  function revokeCall(id: string) {
    return import("@/app/api/me/api-keys/[id]/route").then(({ DELETE }) =>
      DELETE(new NextRequest(`http://localhost/api/me/api-keys/${id}`, { method: "DELETE" }), {
        params: Promise.resolve({ id }),
      })
    );
  }

  afterEach(() => {
    sessionUser.current = null;
  });

  it("rejects signed-out callers", async () => {
    const { GET, POST } = await import("@/app/api/me/api-keys/route");
    expect((await GET()).status).toBe(401);
    expect((await POST(postReq({ label: "x", expiresInDays: 30, currentPassword: PASSWORD }))).status).toBe(401);
  });

  it("refuses to create a key with the wrong password", async () => {
    const { POST } = await import("@/app/api/me/api-keys/route");
    const { default: ApiKey } = await import("@/models/ApiKey");
    await signIn();
    const res = await POST(postReq({ label: "phone", expiresInDays: 30, currentPassword: "wrong" }));
    expect(res.status).toBe(400);
    expect(await ApiKey.countDocuments()).toBe(0);
  });

  it("rejects an unsupported expiry", async () => {
    const { POST } = await import("@/app/api/me/api-keys/route");
    await signIn();
    const res = await POST(postReq({ label: "phone", expiresInDays: 10000, currentPassword: PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("creates a key that is shown once, stored hashed, and authenticates", async () => {
    const { GET, POST } = await import("@/app/api/me/api-keys/route");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { verifyN8nAuth, hashKey } = await import("@/lib/integrations/auth");
    const user = await signIn();

    const res = await POST(postReq({ label: "phone", expiresInDays: 30, currentPassword: PASSWORD }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { data } = await res.json();
    expect(data.key).toMatch(/^etk_[0-9a-f]{64}$/);

    const stored = await ApiKey.findById(data._id).lean<{ keyHash: string; expiresAt: Date; createdVia: string }>();
    expect(stored!.keyHash).toBe(hashKey(data.key));
    expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    expect(stored!.createdVia).toBe("web");

    const list = await (await GET()).json();
    expect(list.data).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toContain(data.key);
    expect(list.data[0].keyHash).toBeUndefined();

    const auth = await verifyN8nAuth(
      new NextRequest("http://localhost/api/integrations/accounts", { headers: { authorization: `Bearer ${data.key}` } }),
      "req-web-key"
    );
    expect("user" in auth && auth.user.id).toBe(user._id.toString());
  });

  it("revokes a key immediately and keeps the record", async () => {
    const { GET, POST } = await import("@/app/api/me/api-keys/route");
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    await signIn();
    const { data } = await (await POST(postReq({ label: "phone", expiresInDays: null, currentPassword: PASSWORD }))).json();

    expect((await revokeCall(data._id)).status).toBe(200);
    expect((await revokeCall(data._id)).status).toBe(404);

    const auth = await verifyN8nAuth(
      new NextRequest("http://localhost/api/integrations/accounts", { headers: { authorization: `Bearer ${data.key}` } }),
      "req-revoked"
    );
    expect("errorResponse" in auth).toBe(true);

    const list = await (await GET()).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].revoked).toBe(true);
    expect(list.data[0].revokedAt).toBeTruthy();
  });

  it("does not let one user see or revoke another user's key", async () => {
    const { GET, POST } = await import("@/app/api/me/api-keys/route");
    await signIn();
    const { data } = await (await POST(postReq({ label: "mine", expiresInDays: 30, currentPassword: PASSWORD }))).json();

    await signIn();
    expect((await revokeCall(data._id)).status).toBe(404);
    expect((await revokeCall("not-an-id")).status).toBe(404);
    expect((await (await GET()).json()).data).toHaveLength(0);
  });

  it("rate-limits key creation per user", async () => {
    const { POST } = await import("@/app/api/me/api-keys/route");
    await signIn();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await POST(postReq({ label: `k${i}`, expiresInDays: 30, currentPassword: "wrong" }))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

// ── src/lib/integrations/idempotency.ts ────────────────────────────────────

describe("withIdempotency", () => {
  it("executes once for a new key", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    const execute = vi.fn().mockResolvedValue({ status: 201, body: { id: "1" } });
    const outcome = await withIdempotency({
      userId: "u1",
      endpoint: "test:endpoint",
      key: "key-1",
      body: { a: 1 },
      execute,
    });
    expect(outcome.kind).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("replays the stored response for the same key + same body", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    const execute = vi.fn().mockResolvedValue({ status: 201, body: { id: "2" } });
    const params = { userId: "u1", endpoint: "test:endpoint", key: "key-2", body: { a: 1 }, execute };

    const first = await withIdempotency(params);
    const second = await withIdempotency(params);

    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("replayed");
    if (second.kind === "replayed") expect(second.body).toMatchObject({ id: "2" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects the same key reused with a different body", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    const execute = vi.fn().mockResolvedValue({ status: 201, body: { id: "3" } });
    await withIdempotency({ userId: "u1", endpoint: "test:endpoint", key: "key-3", body: { a: 1 }, execute });
    const second = await withIdempotency({
      userId: "u1",
      endpoint: "test:endpoint",
      key: "key-3",
      body: { a: 2 },
      execute,
    });
    expect(second.kind).toBe("conflict");
    if (second.kind === "conflict") expect(second.reason).toBe("fingerprint_mismatch");
  });

  it("resolves concurrent duplicate requests as one execution + one conflict", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    let resolveExecute: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
    const execute = vi.fn().mockImplementation(async () => {
      await gate;
      return { status: 201, body: { id: "4" } };
    });

    const params = { userId: "u1", endpoint: "test:endpoint", key: "key-4", body: { a: 1 }, execute };
    const first = withIdempotency(params);
    // Give the first call time to insert its "pending" record before the second starts.
    await new Promise((r) => setTimeout(r, 50));
    const second = await withIdempotency(params);

    expect(second.kind).toBe("conflict");
    if (second.kind === "conflict") expect(second.reason).toBe("in_progress");

    resolveExecute!();
    const firstResult = await first;
    expect(firstResult.kind).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// ── POST /api/integrations/transactions (end-to-end through the route) ────

describe("POST /api/integrations/transactions", () => {
  const TEST_KEY = "test-n8n-api-key-value";
  const TEST_EMAIL = "n8n-route-user@example.com";
  let accountId: string;

  function makeReq(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest("http://localhost/api/integrations/transactions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
        "idempotency-key": "test-key-1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "N8N Route User", email: TEST_EMAIL, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "test", keyHash: hashKey(TEST_KEY), lastFour: TEST_KEY.slice(-4) });
    const account = await Account.create({
      user: user._id,
      name: "Wallet",
      type: "cash",
      balance: 10000,
      currency: "INR",
    });
    accountId = account._id.toString();
  });

  const validBody = () => ({
    accountId,
    type: "expense",
    amount: 1500,
    category: "Food",
    date: new Date().toISOString(),
  });

  it("creates a transaction and returns 201", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const res = await POST(makeReq(validBody()), {});
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.amount).toBe(1500);
    expect(json.data.type).toBe("expense");
  });

  it("rejects a missing Idempotency-Key with 400", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const req = new NextRequest("http://localhost/api/integrations/transactions", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    const res = await POST(req, {});
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid API key with 401", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const res = await POST(makeReq(validBody(), { authorization: "Bearer wrong" }), {});
    expect(res.status).toBe(401);
  });

  it("rejects an invalid body with 400", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const res = await POST(
      makeReq({ accountId, type: "expense", amount: -5, category: "Food", date: "not-a-date" }),
      {}
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a nonexistent account", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const res = await POST(makeReq({ ...validBody(), accountId: "64f000000000000000000000" }), {});
    expect(res.status).toBe(404);
  });

  it("replays the same response on a duplicate Idempotency-Key retry (no second transaction)", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const { default: Transaction } = await import("@/models/Transaction");

    // Same literal body on both requests — a real retry resends the exact
    // bytes it sent before, it doesn't recompute a fresh timestamp.
    const body = validBody();
    const first = await POST(makeReq(body), {});
    const firstJson = await first.json();
    const second = await POST(makeReq(body), {});
    const secondJson = await second.json();

    expect(secondJson.data.id).toBe(firstJson.data.id);

    const count = await Transaction.countDocuments({});
    expect(count).toBe(1);
  });

  it("rejects the same Idempotency-Key reused with a different body (409)", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    await POST(makeReq(validBody()), {});
    const res = await POST(makeReq({ ...validBody(), amount: 9999 }), {});
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});

// ── src/lib/capture/parsers ────────────────────────────────────────────────

describe("parseCapture", () => {
  // 12:00 IST on 26 Sep 2026.
  const RECEIVED = new Date("2026-09-26T06:30:00Z");

  // Anonymized real-world phrasings, one per bank family.
  const MONEY_FIXTURES: [string, { type: string; amount: number; last4?: string; ref?: string; merchant?: string }][] = [
    [
      "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678. Not you? Call 18002586161",
      { type: "expense", amount: 25000, last4: "1234", ref: "426912345678", merchant: "swiggy@icici" },
    ],
    [
      "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 26/09/26 Ref 426912345678 Not You? Call 18002586161",
      { type: "expense", amount: 25000, last4: "1234", ref: "426912345678", merchant: "SWIGGY" },
    ],
    [
      "INR 1,200.00 credited to your A/c No XX5678 on 26 Sep 2026 by NEFT from ACME PVT LTD. Avl Bal INR 45,000.00",
      { type: "income", amount: 120000, last4: "5678", merchant: "ACME PVT LTD" },
    ],
    [
      "Dear Customer, Rs.499.00 spent on ICICI Bank Card XX9012 on 26-Sep-26 at AMAZON. Avl Lmt: Rs 1,20,000.00",
      { type: "expense", amount: 49900, last4: "9012", merchant: "AMAZON" },
    ],
    [
      "A/c *4321 debited Rs 1000.00 on 26Sep26 trf to RAHUL. Ref No 123456789. -Kotak",
      { type: "expense", amount: 100000, last4: "4321", ref: "123456789", merchant: "RAHUL" },
    ],
    [
      "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card ending XX1832 at PAYPAL *XINDAWNCOMP on 24 JUN 2026 at 04:04 PM Avbl Limit: INR 10309.48",
      { type: "expense", amount: 89615, last4: "1832", merchant: "PAYPAL *XINDAWNCOMP" },
    ],
    [
      "Dear UPI user A/C X1234 debited by 250.0 on date 26Sep26 trf to SWIGGY Refno 426912345678. If not u? call 1800111109. -SBI",
      { type: "expense", amount: 25000, last4: "1234", merchant: "SWIGGY" },
    ],
  ];

  for (const [text, expected] of MONEY_FIXTURES) {
    it(`parses: ${text.slice(0, 48)}…`, async () => {
      const { parseCapture, CONFIDENCE_AUTO_CREATE } = await import("@/lib/capture/parsers");
      const p = parseCapture(text, RECEIVED);
      expect(p.kind).toBe("money");
      if (p.kind !== "money") return;
      expect(p.type).toBe(expected.type);
      expect(p.amountMinor).toBe(expected.amount);
      expect(p.last4).toBe(expected.last4);
      if (expected.ref) expect(p.ref).toBe(expected.ref);
      if (expected.merchant) expect(p.merchant).toBe(expected.merchant);
      expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
    });
  }

  it("never parses the balance figure as the amount", async () => {
    const { parseCapture } = await import("@/lib/capture/parsers");
    const p = parseCapture("Avl Bal Rs 45,000.00. Rs 120.00 debited from A/c XX1234 on 26-09-26", RECEIVED);
    expect(p.kind === "money" && p.amountMinor).toBe(12000);
  });

  it.each([
    ["123456 is your OTP for txn of Rs 500 at AMAZON. Do not share.", "otp"],
    ["Your credit card bill of Rs 5,000 is due on 05-Oct-26. Minimum amount due Rs 250.", "reminder"],
    ["Get a pre-approved personal loan of Rs 5,00,000. Apply now!", "promo"],
    ["RAHUL has requested money Rs 500 from you on UPI. Pay now", "not_financial"],
  ])("ignores %s", async (text, reason) => {
    const { parseCapture } = await import("@/lib/capture/parsers");
    const p = parseCapture(text, RECEIVED);
    expect(p.kind).toBe("ignored");
    if (p.kind === "ignored") expect(p.reason).toBe(reason);
  });

  it("parses dates in IST: a stated time is exact, a missing one borrows receivedAt but isn't precise", async () => {
    const { parseCapture } = await import("@/lib/capture/parsers");
    const timed = parseCapture(
      "Happy Shopping! INR 10.00 spent on your IDFC FIRST Bank Credit Card ending XX1832 at X on 24 JUN 2026 at 04:04 PM",
      RECEIVED
    );
    expect(timed.kind === "money" && timed.date?.toISOString()).toBe("2026-06-24T10:34:00.000Z");
    expect(timed.kind === "money" && timed.hasTime).toBe(true);

    const sameDay = parseCapture("Rs 10 debited from A/c XX1234 on 26-09-26", RECEIVED);
    expect(sameDay.kind === "money" && sameDay.date?.toISOString()).toBe(RECEIVED.toISOString());
    expect(sameDay.kind === "money" && sameDay.hasTime).toBe(false);

    const otherDay = parseCapture("Rs 10 debited from A/c XX1234 on 20-09-26", RECEIVED);
    // Noon IST, not UTC midnight (05:30 IST).
    expect(otherDay.kind === "money" && otherDay.date?.toISOString()).toBe("2026-09-20T06:30:00.000Z");
  });

  it("lowers confidence when no account digits or date are present", async () => {
    const { parseCapture, CONFIDENCE_AUTO_CREATE } = await import("@/lib/capture/parsers");
    const p = parseCapture("₹250 paid to Swiggy", RECEIVED);
    expect(p.kind === "money" && p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });
});

// ── src/lib/capture/ingest.ts + src/lib/reconcile/* ────────────────────────

describe("capture ingest and reconcile", () => {
  const T0 = new Date("2026-09-26T06:30:00Z");
  const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
  const SMS = "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678. Not you? Call 18002586161";
  const NOTIFICATION = "₹250 paid to Swiggy from A/c XX1234";

  async function setup(balance = 100000) {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "Cap", email: `c${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const account = await Account.create({
      user: user._id,
      name: "HDFC Savings",
      type: "bank",
      balance,
      currency: "INR",
      smsLastFour: ["1234"],
    });
    const other = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 50000, currency: "INR" });
    const actor = { id: user._id.toString(), name: user.name, email: user.email, role: "user" };
    return { user, account, other, actor };
  }

  async function ingest(actor: { id: string; name: string; email: string; role: string }, channel: "sms" | "notification" | "n8n", text: string, receivedAt: Date) {
    const { ingestCapture } = await import("@/lib/capture/ingest");
    return ingestCapture({ user: actor, channel, text, receivedAt, sender: channel === "sms" ? "VM-HDFCBK" : undefined });
  }

  async function balanceOf(id: unknown) {
    const { default: Account } = await import("@/models/Account");
    return (await Account.findById(id).lean<{ balance: number }>())!.balance;
  }

  async function liveTxns(userId: unknown) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.find({ user: userId, isDeleted: { $ne: true } }).lean<
      { _id: unknown; amount: number; source: string; reviewStatus: string | null; captures: unknown[]; description: string }[]
    >();
  }

  async function ledgerOk(userId: string) {
    const { verifyLedgerChain } = await import("@/lib/ledger");
    const result = (await verifyLedgerChain(userId)) as { valid: boolean };
    expect(result.valid).toBe(true);
  }

  it("creates an unreviewed SMS transaction and stores the raw text encrypted", async () => {
    const { actor, account } = await setup();
    const res = await ingest(actor, "sms", SMS, T0);
    expect(res.httpStatus).toBe(201);
    expect(res.body.status).toBe("created");

    const [txn] = await liveTxns(actor.id);
    expect(txn.amount).toBe(25000);
    expect(txn.source).toBe("sms");
    expect(txn.reviewStatus).toBe("unreviewed");
    expect(await balanceOf(account._id)).toBe(100000 - 25000);

    const { default: CapturedMessage } = await import("@/models/CapturedMessage");
    const raw = await mongoose.connection.db!.collection("captured_messages").findOne({});
    // The raw message never sits in the DB as plain text. (Parsed fields such
    // as the merchant are stored plainly: they become the transaction anyway.)
    expect(JSON.stringify(raw)).not.toContain("Not you? Call");
    expect(await CapturedMessage.countDocuments()).toBe(1);
    await ledgerOk(actor.id);
  });

  it("recognises the same SMS from n8n, with a sender prefix, a day later: one transaction", async () => {
    const { actor } = await setup();
    await ingest(actor, "sms", SMS, T0);
    const again = await ingest(actor, "n8n", `VM-HDFCBK: ${SMS}  `, minutes(25 * 60));
    expect(again.body.status).toBe("duplicate");
    expect(await liveTxns(actor.id)).toHaveLength(1);
  });

  it("ignores an OTP message and creates nothing", async () => {
    const { actor } = await setup();
    const res = await ingest(actor, "sms", "123456 is your OTP for txn of Rs 500 at AMAZON. Do not share.", T0);
    expect(res.body.status).toBe("ignored");
    expect(await liveTxns(actor.id)).toHaveLength(0);
  });

  it("holds a notification, then uses the SMS values when the SMS arrives (SMS is source of truth)", async () => {
    const { actor, account } = await setup();
    const held = await ingest(actor, "notification", NOTIFICATION, T0);
    expect(held.httpStatus).toBe(202);
    expect(held.body.status).toBe("pending");
    expect(await liveTxns(actor.id)).toHaveLength(0);

    const sms = await ingest(actor, "sms", SMS, minutes(3));
    expect(sms.body.status).toBe("created");

    const txns = await liveTxns(actor.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].source).toBe("sms");
    expect(txns[0].description).toBe("swiggy@icici");
    expect(txns[0].captures).toHaveLength(2);
    expect(await balanceOf(account._id)).toBe(75000);

    const { default: CapturedMessage } = await import("@/models/CapturedMessage");
    const notif = await CapturedMessage.findById(held.body.captureId).lean<{ role: string; outcome: string }>();
    expect(notif).toMatchObject({ role: "supporting", outcome: "duplicate" });
  });

  it("merges a late SMS (hours after the notification, no time in text) by IST day", async () => {
    const { actor } = await setup();
    await ingest(actor, "notification", NOTIFICATION, T0);
    await ingest(actor, "sms", SMS, minutes(4));
    // A second copy of the same payment via n8n, worded differently, hours later.
    const n8n = await ingest(actor, "n8n", "Rs 250.00 debited from A/c XX1234 on 26-09-26. UPI Ref 426912345678", minutes(180));
    expect(n8n.body.status).toBe("duplicate");
    expect(await liveTxns(actor.id)).toHaveLength(1);
  });

  it("promotes a notification whose SMS never came, labelled as the lower-priority source", async () => {
    const { actor } = await setup();
    await ingest(actor, "notification", NOTIFICATION, T0);
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    const { promoted } = await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    expect(promoted).toBe(1);

    const [txn] = await liveTxns(actor.id);
    expect(txn.source).toBe("notification");
    expect(txn.reviewStatus).toBe("unreviewed");

    const { getReviewInbox } = await import("@/lib/reconcile/inbox");
    const inbox = await getReviewInbox(actor.id);
    expect(inbox.needsReview[0].sourceInfo.priority).toBe("fallback");
  });

  it("lets a later SMS override notification values, keeping the old values as a correction", async () => {
    const { actor, account } = await setup();
    await ingest(actor, "notification", "₹250 paid to Swiggy from A/c XX1234. UPI Ref 426912345678", T0);
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    expect(await balanceOf(account._id)).toBe(75000);

    const sms = await ingest(actor, "sms", SMS.replace("Rs.250.00", "Rs.260.00"), minutes(120));
    expect(sms.body.status).toBe("updated");

    const txns = await liveTxns(actor.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(26000);
    expect(txns[0].source).toBe("sms");
    expect(await balanceOf(account._id)).toBe(74000);

    const { default: TransactionCorrection } = await import("@/models/TransactionCorrection");
    const [c] = await TransactionCorrection.find({ transaction: txns[0]._id }).lean<
      { reason: string; via: string; before: { amount: number }; after: { amount: number } }[]
    >();
    expect(c).toMatchObject({ reason: "sms_override", via: "system", before: { amount: 25000 }, after: { amount: 26000 } });
    await ledgerOk(actor.id);
  });

  it("never silently overrides values the user confirmed: queues a source conflict instead", async () => {
    const { actor, account } = await setup();
    const ref = ". UPI Ref 426912345678";
    await ingest(actor, "notification", `₹250 paid to Swiggy from A/c XX1234${ref}`, T0);
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    const [txn] = await liveTxns(actor.id);
    const { confirmTransaction } = await import("@/lib/reconcile/correct");
    await confirmTransaction(actor.id, String(txn._id), actor);

    const sms = await ingest(actor, "sms", SMS.replace("Rs.250.00", "Rs.260.00"), minutes(30));
    expect(sms.body.status).toBe("queued");
    expect(sms.body.reason).toBe("source_conflict");
    expect((await liveTxns(actor.id))[0].amount).toBe(25000);

    const { resolveCapture } = await import("@/lib/reconcile/inbox");
    await resolveCapture({ userId: actor.id, captureId: sms.body.captureId, input: { action: "use_sms" }, actor, via: "web" });
    const [after] = await liveTxns(actor.id);
    expect(after.amount).toBe(26000);
    expect(after.reviewStatus).toBe("corrected");
    expect(await balanceOf(account._id)).toBe(74000);
  });

  it("keep_mine resolves a conflict without moving money, and records the decision", async () => {
    const { actor, account } = await setup();
    await ingest(actor, "notification", "₹250 paid to Swiggy from A/c XX1234. UPI Ref 426912345678", T0);
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    const [txn] = await liveTxns(actor.id);
    const { confirmTransaction } = await import("@/lib/reconcile/correct");
    await confirmTransaction(actor.id, String(txn._id), actor);
    const sms = await ingest(actor, "sms", SMS.replace("Rs.250.00", "Rs.260.00"), minutes(30));

    const { resolveCapture } = await import("@/lib/reconcile/inbox");
    await resolveCapture({ userId: actor.id, captureId: sms.body.captureId, input: { action: "keep_mine" }, actor, via: "mobile" });
    expect((await liveTxns(actor.id))[0].amount).toBe(25000);
    expect(await balanceOf(account._id)).toBe(75000);
    const { default: TransactionCorrection } = await import("@/models/TransactionCorrection");
    expect(await TransactionCorrection.countDocuments({ reason: "kept_user_values" })).toBe(1);
  });

  it("treats a notification after its SMS as a duplicate that changes nothing", async () => {
    const { actor, account } = await setup();
    await ingest(actor, "sms", SMS, T0);
    const notif = await ingest(actor, "notification", "₹999 paid to Swiggy from A/c XX1234. UPI Ref 426912345678", minutes(1));
    expect(notif.body.status).toBe("duplicate");
    expect((await liveTxns(actor.id))[0].amount).toBe(25000);
    expect(await balanceOf(account._id)).toBe(75000);
  });

  it("keeps two real payments with the same amount apart (same channel, or different refs)", async () => {
    const { actor } = await setup();
    await ingest(actor, "sms", "Rs.200.00 debited from A/c XX1234 on 26-09-26 to VPA cafe@ybl. UPI Ref 111111111111", T0);
    await ingest(actor, "sms", "Rs.200.00 debited from A/c XX1234 on 26-09-26 to VPA cafe@ybl. UPI Ref 222222222222", minutes(2));
    await ingest(actor, "notification", "₹200 paid to cafe from A/c XX1234. UPI Ref 333333333333", minutes(3));
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    expect(await liveTxns(actor.id)).toHaveLength(3);
  });

  it("asks instead of guessing when the account is unknown on one side", async () => {
    const { actor } = await setup();
    await ingest(actor, "sms", SMS, T0);
    // n8n copy worded without account digits: same payment? Not certain.
    const res = await ingest(actor, "n8n", "Rs 250.00 paid to swiggy on 26-09-26", minutes(1));
    expect(res.body.status).toBe("queued");
    expect(res.body.reason).toBe("possible_duplicate");

    const { resolveCapture } = await import("@/lib/reconcile/inbox");
    await resolveCapture({ userId: actor.id, captureId: res.body.captureId, input: { action: "link" }, actor, via: "web" });
    const txns = await liveTxns(actor.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].captures).toHaveLength(2);
  });

  it("queues an unmatched account, and 'create' with rememberDigits matches the next one", async () => {
    const { actor, other } = await setup();
    const q = await ingest(actor, "sms", "Rs.80.00 debited from A/c XX9999 on 26-09-26 to VPA tea@ybl", T0);
    expect(q.body.reason).toBe("no_matching_account");

    const { resolveCapture } = await import("@/lib/reconcile/inbox");
    await resolveCapture({
      userId: actor.id,
      captureId: q.body.captureId,
      input: { action: "create", accountId: String(other._id), type: "expense", amount: 8000, category: "food", rememberDigits: true },
      actor,
      via: "web",
    });
    const next = await ingest(actor, "sms", "Rs.90.00 debited from A/c XX9999 on 26-09-26 to VPA tea@ybl", minutes(60));
    expect(next.body.status).toBe("created");
    expect(await balanceOf(other._id)).toBe(50000 - 8000 - 9000);
  });

  it("correction matrix: amount, type flip, account move and void each move the right balances", async () => {
    const { actor, account, other } = await setup();
    const res = await ingest(actor, "sms", SMS, T0);
    const txnId = res.body.transactionId!;
    const { correctTransaction } = await import("@/lib/reconcile/correct");

    await correctTransaction({ userId: actor.id, transactionId: txnId, changes: { amount: 30000 }, reason: "wrong_amount", via: "web", actor });
    expect(await balanceOf(account._id)).toBe(70000);

    await correctTransaction({ userId: actor.id, transactionId: txnId, changes: { type: "income" }, reason: "wrong_type", via: "web", actor });
    expect(await balanceOf(account._id)).toBe(130000);

    await correctTransaction({
      userId: actor.id,
      transactionId: txnId,
      changes: { accountId: String(other._id) },
      reason: "wrong_account",
      via: "mobile",
      actor,
    });
    expect(await balanceOf(account._id)).toBe(100000);
    expect(await balanceOf(other._id)).toBe(80000);

    await correctTransaction({ userId: actor.id, transactionId: txnId, changes: {}, reason: "duplicate", via: "web", actor });
    expect(await balanceOf(other._id)).toBe(50000);
    expect(await liveTxns(actor.id)).toHaveLength(0);

    const { default: TransactionCorrection } = await import("@/models/TransactionCorrection");
    const rows = await TransactionCorrection.find({ transaction: txnId }).sort({ createdAt: 1 }).lean<{ reason: string; after: unknown }[]>();
    expect(rows.map((r) => r.reason)).toEqual(["wrong_amount", "wrong_type", "wrong_account", "duplicate"]);
    expect(rows[3].after).toBeNull();
    await ledgerOk(actor.id);
  });

  it("guards: no-op correction, transfers, and another user's transaction", async () => {
    const { actor, account, other } = await setup();
    const res = await ingest(actor, "sms", SMS, T0);
    const { correctTransaction, ReconcileError } = await import("@/lib/reconcile/correct");

    await expect(
      correctTransaction({ userId: actor.id, transactionId: res.body.transactionId!, changes: { amount: 25000 }, reason: "wrong_amount", via: "web", actor })
    ).rejects.toMatchObject({ code: "NO_CHANGES" });

    const { createTransaction } = await import("@/lib/transaction-service");
    const t = await createTransaction({
      userId: actor.id,
      actor,
      accountId: String(account._id),
      transferToId: String(other._id),
      type: "transfer",
      amount: 1000,
      currency: "INR",
      category: "transfer",
      date: T0.toISOString(),
      tags: [],
      isRecurring: false,
    });
    const transferId = String((t.transaction as { _id: unknown })._id);
    await expect(
      correctTransaction({ userId: actor.id, transactionId: transferId, changes: { amount: 5 }, reason: "wrong_amount", via: "web", actor })
    ).rejects.toMatchObject({ code: "NOT_CORRECTABLE" });

    const stranger = await setup();
    await expect(
      correctTransaction({ userId: stranger.actor.id, transactionId: res.body.transactionId!, changes: { amount: 5 }, reason: "wrong_amount", via: "web", actor: stranger.actor })
    ).rejects.toBeInstanceOf(ReconcileError);
  });

  it("applies concurrent captures on one account without losing a balance update", async () => {
    const { actor, account } = await setup(100000);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ingest(actor, "sms", `Rs.10.00 debited from A/c XX1234 on 26-09-26 to VPA shop${i}@ybl. UPI Ref 90000000000${i}`, T0)
      )
    );
    expect(await liveTxns(actor.id)).toHaveLength(10);
    expect(await balanceOf(account._id)).toBe(100000 - 10 * 1000);
  });

  it("web routes: session-scoped corrections, provenance with the decrypted text", async () => {
    const { actor } = await setup();
    const res = await ingest(actor, "sms", SMS, T0);
    const id = res.body.transactionId!;
    sessionUser.current = actor;
    try {
      const { POST, GET } = await import("@/app/api/transactions/[id]/corrections/route");
      const ctx = { params: Promise.resolve({ id }) };
      const post = await POST(
        new NextRequest(`http://localhost/api/transactions/${id}/corrections`, {
          method: "POST",
          body: JSON.stringify({ changes: { amount: 26000 }, reason: "wrong_amount" }),
        }),
        ctx
      );
      expect(post.status).toBe(201);

      const got = await (await GET(new NextRequest(`http://localhost/api/transactions/${id}/corrections`), ctx)).json();
      expect(got.data.captures[0].text).toBe(SMS);
      expect(got.data.captures[0].source.label).toBe("SMS (source of truth)");
      expect(got.data.corrections).toHaveLength(1);

      sessionUser.current = (await setup()).actor;
      const foreign = await GET(new NextRequest(`http://localhost/api/transactions/${id}/corrections`), ctx);
      expect(foreign.status).toBe(404);
    } finally {
      sessionUser.current = null;
    }
  });

  it("phone review routes need an Idempotency-Key and replay retries without a second correction", async () => {
    const { actor } = await setup();
    const res = await ingest(actor, "sms", SMS, T0);
    const id = res.body.transactionId!;

    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const key = "etk_test_phone_key_value";
    await ApiKey.create({ user: actor.id, label: "phone", keyHash: hashKey(key), lastFour: key.slice(-4) });

    const { POST } = await import("@/app/api/integrations/review/transactions/[id]/corrections/route");
    const ctx = { params: Promise.resolve({ id }) };
    const call = (headers: Record<string, string>) =>
      POST(
        new NextRequest(`http://localhost/api/integrations/review/transactions/${id}/corrections`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, ...headers },
          body: JSON.stringify({ changes: { amount: 27000 }, reason: "wrong_amount" }),
        }),
        ctx
      );

    expect((await call({})).status).toBe(400);
    expect((await call({ "idempotency-key": "fix-1" })).status).toBe(200);
    expect((await call({ "idempotency-key": "fix-1" })).status).toBe(200);

    const { default: TransactionCorrection } = await import("@/models/TransactionCorrection");
    expect(await TransactionCorrection.countDocuments({ transaction: id })).toBe(1);
    expect((await liveTxns(actor.id))[0].amount).toBe(27000);
  });
});

// ── home/dashboard read paths (src/lib/transaction-query.ts, stats-service.ts, budget-service.ts) ──

describe("home read paths", () => {
  async function seed() {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const user = await User.create({ name: "Home", email: `h${Date.now()}${Math.random()}@x.com`, password: "hash" });
    const account = await Account.create({ user: user._id, name: "HDFC", type: "bank", balance: 0, currency: "INR" });
    const now = new Date();
    const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12);
    const base = { user: user._id, account: account._id, currency: "INR" };
    const rid = new mongoose.Types.ObjectId();
    await Transaction.create([
      { ...base, type: "expense", amount: 100, category: "food", date: day(1), description: "a" },
      { ...base, type: "income", amount: 5000, category: "salary", date: day(3), description: "b" },
      { ...base, type: "expense", amount: 200, category: "food", date: day(5), description: "c" },
      // Future-dated: hidden.
      { ...base, type: "expense", amount: 999, category: "food", date: day(-3), description: "future" },
      // Paid installment due long ago but paid yesterday: listed by paidAt.
      { ...base, type: "expense", amount: 300, category: "emi", date: day(40), description: "emi-paid", recurringId: rid, installmentIndex: 1, installmentStatus: "paid", paidAt: day(0) },
      // Paid installment without paidAt: listed by its date.
      { ...base, type: "expense", amount: 310, category: "emi", date: day(2), description: "emi-nopaidat", recurringId: rid, installmentIndex: 2, installmentStatus: "paid" },
      // Unpaid installment: hidden.
      { ...base, type: "expense", amount: 320, category: "emi", date: day(4), description: "emi-unpaid", recurringId: rid, installmentIndex: 3, installmentStatus: "upcoming" },
      { ...base, type: "expense", amount: 50, category: "food", date: day(6), description: "deleted", isDeleted: true },
    ]);
    return { userId: user._id.toString() };
  }

  it("lists newest activity first with the fast path, matching the full aggregation", async () => {
    const { listTransactions } = await import("@/lib/transaction-query");
    const { userId } = await seed();
    const full = await listTransactions({ userId, skip: 0, limit: 50, hideFuture: true });
    expect(full.data.map((t: { description: string }) => t.description)).toEqual(["emi-paid", "a", "emi-nopaidat", "b", "c"]);
    expect(full.total).toBe(5);
    const page = await listTransactions({ userId, skip: 1, limit: 2, hideFuture: true });
    expect(page.data.map((t: { description: string }) => t.description)).toEqual(["a", "emi-nopaidat"]);
    expect(page.total).toBe(5);
    const noTotal = await listTransactions({ userId, skip: 0, limit: 3, hideFuture: true, includeTotal: false });
    expect(noTotal.data).toHaveLength(3);
    expect(noTotal.total).toBeNull();
  });

  it("counts a paid installment in the month it was paid", async () => {
    const { getMonthlyStats } = await import("@/lib/stats-service");
    const { userId } = await seed();
    const now = new Date();
    const stats = await getMonthlyStats(userId, now.getFullYear(), now.getMonth() + 1);
    // Only rows whose activity date falls this month (fixture days are near today).
    const { default: Transaction } = await import("@/models/Transaction");
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const rows = await Transaction.find({ user: userId, isDeleted: { $ne: true } }).lean<
      Array<{ type: string; amount: number; date: Date; paidAt?: Date; installmentStatus?: string; recurringId?: unknown }>
    >();
    const expected = rows
      .filter((t) => !(t.recurringId && t.installmentStatus !== "paid"))
      .map((t) => ({ ...t, at: t.installmentStatus === "paid" && t.paidAt ? t.paidAt : t.date }))
      .filter((t) => t.at >= start && t.at < end);
    const sum = (type: string) => expected.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
    expect(stats.income).toBe(sum("income"));
    expect(stats.expense).toBe(sum("expense"));
  });

  it("computes budget spend and rollover in one pass", async () => {
    const { listBudgetsWithSpend } = await import("@/lib/budget-service");
    const { default: Budget } = await import("@/models/Budget");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "B", email: `b${Date.now()}${Math.random()}@x.com`, password: "hash" });
    const account = await Account.create({ user: user._id, name: "W", type: "cash", balance: 0, currency: "INR" });
    const y = 2026;
    const base = { user: user._id, account: account._id, currency: "INR", type: "expense" };
    await Transaction.create([
      { ...base, amount: 400, category: "food", date: new Date(y, 5, 10) }, // June
      { ...base, amount: 100, category: "food", date: new Date(y, 4, 20) }, // May
      { ...base, amount: 700, category: "fuel", date: new Date(y, 5, 2) },
      { ...base, amount: 900, category: "food", date: new Date(y, 6, 1) }, // July: outside
    ]);
    await Budget.create([
      { user: user._id, category: "food", month: 6, year: y, limitAmount: 1000, rollover: true },
      { user: user._id, category: "food", month: 5, year: y, limitAmount: 500 },
      { user: user._id, category: "fuel", month: 6, year: y, limitAmount: 600 },
    ]);
    const rows = await listBudgetsWithSpend(user._id.toString(), y, 6);
    const food = rows.find((b) => b.category === "food")!;
    const fuel = rows.find((b) => b.category === "fuel")!;
    expect(food.spent).toBe(400);
    expect(food.effectiveLimit).toBe(1000 + (500 - 100));
    expect(fuel.spent).toBe(700);
    expect(fuel.effectiveLimit).toBe(600);
  });
});

describe("integration auth cache and GET /api/integrations/home", () => {
  const KEY = "test-home-api-key-value";

  async function setup() {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Home User", email: `hu${Date.now()}@x.com`, password: "hash", isActive: true });
    const key = await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "HDFC Bank", type: "bank", balance: 12345, currency: "INR" });
    const now = new Date();
    await Transaction.create(
      [1, 2, 3, 4].map((n) => ({
        user: user._id,
        account: account._id,
        type: "expense",
        amount: n * 100,
        currency: "INR",
        category: "food",
        description: `t${n}`,
        date: new Date(now.getTime() - n * 60_000),
      }))
    );
    return { user, key };
  }

  const req = () => new NextRequest("http://localhost/api/integrations/home", { headers: { authorization: `Bearer ${KEY}` } });

  it("returns accounts, stats, the latest 3 and review counts in one response", async () => {
    await setup();
    const { GET } = await import("@/app/api/integrations/home/route");
    const res = await GET(req(), undefined as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user.name).toBe("Home User");
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.latest.map((t: { description: string }) => t.description)).toEqual(["t1", "t2", "t3"]);
    expect(body.data.stats.expense).toBeGreaterThan(0);
    expect(body.data.reviewCounts).toEqual({ needsReview: 0, couldntMatch: 0, waitingForSms: 0 });
  });

  it("serves a repeat request from the auth cache, and a revoke on this instance takes effect at once", async () => {
    const { key } = await setup();
    const { verifyN8nAuth, forgetApiKey } = await import("@/lib/integrations/auth");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const first = await verifyN8nAuth(req(), "r1");
    expect("user" in first).toBe(true);

    const spy = vi.spyOn(ApiKey, "findOne");
    const second = await verifyN8nAuth(req(), "r2");
    expect("user" in second).toBe(true);
    expect(spy).not.toHaveBeenCalled();

    await ApiKey.updateOne({ _id: key._id }, { $set: { revoked: true } });
    forgetApiKey(key._id.toString());
    const third = await verifyN8nAuth(req(), "r3");
    expect("errorResponse" in third).toBe(true);
    spy.mockRestore();
  });
});

describe("account matching by bank when no digits are saved", () => {
  const SMS_6390 =
    "Sent Rs.10.00 From HDFC Bank A/C *6390 To Amegh T T S On 30/09/26 Ref 700150778879 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808";
  const at = new Date("2026-09-30T06:00:00Z");

  async function user() {
    const { default: User } = await import("@/models/User");
    const u = await User.create({ name: "M", email: `m${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    return { id: u._id.toString(), name: u.name, email: u.email, role: "user" };
  }
  async function account(userId: string, name: string, type: string, extra: Record<string, unknown> = {}) {
    const { default: Account } = await import("@/models/Account");
    return Account.create({ user: userId, name, type, balance: 100000, currency: "INR", ...extra });
  }
  async function ingest(actor: { id: string; name: string; email: string; role: string }, text: string, receivedAt = at) {
    const { ingestCapture } = await import("@/lib/capture/ingest");
    return ingestCapture({ user: actor, channel: "sms", text, receivedAt, sender: "VM-HDFCBK" });
  }

  it("uses the only HDFC bank account (not the HDFC card) and learns its digits on confirm", async () => {
    const actor = await user();
    const bank = await account(actor.id, "HDFC Bank", "bank");
    await account(actor.id, "HDFC Credit Card", "credit_card", { creditMeta: { lastFourDigits: "4321" } });

    const res = await ingest(actor, SMS_6390);
    expect(res.body.status).toBe("created");
    const { default: Transaction } = await import("@/models/Transaction");
    const txn = await Transaction.findOne({ user: actor.id }).lean<{ _id: unknown; account: unknown; reviewStatus: string }>();
    expect(String(txn!.account)).toBe(bank._id.toString());
    expect(txn!.reviewStatus).toBe("unreviewed");

    const { confirmTransaction } = await import("@/lib/reconcile/correct");
    await confirmTransaction(actor.id, String(txn!._id), actor);
    const { default: Account } = await import("@/models/Account");
    expect((await Account.findById(bank._id).lean<{ smsLastFour: string[] }>())!.smsLastFour).toEqual(["6390"]);

    // The next message matches by digits.
    const next = await ingest(actor, SMS_6390.replace("Rs.10.00", "Rs.20.00").replace("700150778879", "700150778880"), new Date(at.getTime() + 3_600_000));
    expect(next.body.status).toBe("created");
    const { default: CapturedMessage } = await import("@/models/CapturedMessage");
    const last = await CapturedMessage.findOne({ user: actor.id }).sort({ createdAt: -1 }).lean<{ accountMatch: string }>();
    expect(last!.accountMatch).toBe("digits");
  });

  it("doesn't guess between two HDFC bank accounts, but suggests one", async () => {
    const actor = await user();
    await account(actor.id, "HDFC Savings", "savings");
    await account(actor.id, "HDFC Salary", "bank");
    const res = await ingest(actor, SMS_6390);
    expect(res.body.status).toBe("queued");
    expect(res.body.reason).toBe("no_matching_account");
    const { getReviewInbox } = await import("@/lib/reconcile/inbox");
    const inbox = await getReviewInbox(actor.id);
    expect(inbox.couldntMatch[0].suggestedAccountId).toBeTruthy();
  });

  it("doesn't use an HDFC account that already has other digits saved (a different account)", async () => {
    const actor = await user();
    await account(actor.id, "HDFC Bank", "bank", { smsLastFour: ["1234"] });
    const res = await ingest(actor, SMS_6390);
    expect(res.body.status).toBe("queued");
  });
});

describe("app update routes", () => {
  const KEY = "test-app-update-api-key-value";
  const release = (over: Record<string, unknown> = {}) => ({
    tag_name: "v1.1.0+11",
    body: "Faster Home.",
    published_at: "2026-10-16T08:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      { id: 7, name: "notes.txt", size: 10 },
      { id: 99, name: "ExpenseCompanion-1.1.0-11.apk", size: 1234, digest: "sha256:ABCDEF" },
    ],
    ...over,
  });

  async function setup() {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "U", email: `au${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
  }

  const req = (path: string) => new NextRequest(`http://localhost/api/integrations/${path}`, { headers: { authorization: `Bearer ${KEY}` } });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.APP_RELEASES_TOKEN;
    const { resetAppUpdateCacheForTests } = await import("@/lib/app-update");
    resetAppUpdateCacheForTests();
  });

  it("parseRelease reads the tag, the apk and its checksum, and ignores anything else", async () => {
    const { parseRelease } = await import("@/lib/app-update");
    const r = parseRelease(release());
    expect(r).toMatchObject({ version: "1.1.0", build: 11, notes: "Faster Home.", apk: { assetId: 99, size: 1234, sha256: "abcdef" } });
    expect(parseRelease(release({ draft: true }))).toBeNull();
    expect(parseRelease(release({ prerelease: true }))).toBeNull();
    expect(parseRelease(release({ tag_name: "nightly" }))).toBeNull();
    expect(parseRelease(release({ assets: [{ id: 1, name: "x.zip", size: 1 }] }))).toBeNull();
    expect(parseRelease(release({ assets: [{ id: 5, name: "a.apk", size: 2 }] }))!.apk.sha256).toBeNull();
  });

  it("reports no update, and never calls GitHub, when no token is configured", async () => {
    await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/integrations/app-update/route");
    const res = await GET(req("app-update"), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ configured: false, latest: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the latest release without the asset id, and caches it", async () => {
    await setup();
    process.env.APP_RELEASES_TOKEN = "ghp_test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(release()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/integrations/app-update/route");
    const body = await (await GET(req("app-update"), undefined as never)).json();
    expect(body.data.configured).toBe(true);
    expect(body.data.latest).toEqual({
      version: "1.1.0",
      build: 11,
      notes: "Faster Home.",
      publishedAt: "2026-10-16T08:00:00Z",
      sizeBytes: 1234,
      sha256: "abcdef",
    });
    await GET(req("app-update"), undefined as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/TVRCloud/expense-tracker-mobile/releases/latest");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
  });

  it("needs a valid API key", async () => {
    await setup();
    const { GET } = await import("@/app/api/integrations/app-update/route");
    const res = await GET(new NextRequest("http://localhost/api/integrations/app-update"), undefined as never);
    expect(res.status).toBe(401);
  });

  it("serves the last good release when GitHub then fails", async () => {
    await setup();
    process.env.APP_RELEASES_TOKEN = "ghp_test";
    const { getLatestAppRelease } = await import("@/lib/app-update");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(release()), { status: 200 })));
    expect((await getLatestAppRelease())?.build).toBe(11);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect((await getLatestAppRelease())?.build).toBe(11);
    vi.useRealTimers();
  });

  it("download hands out GitHub's signed redirect and no APK bytes", async () => {
    await setup();
    process.env.APP_RELEASES_TOKEN = "ghp_test";
    const signed = "https://objects.githubusercontent.com/signed-apk?sig=1";
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/releases/latest")
        ? new Response(JSON.stringify(release()), { status: 200 })
        : new Response(null, { status: 302, headers: { location: signed } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/integrations/app-update/download/route");
    const res = await GET(req("app-update/download"), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ url: signed, build: 11, sizeBytes: 1234, sha256: "abcdef" });
    const assetCall = fetchMock.mock.calls.find((c) => (c as unknown as [string])[0].includes("/releases/assets/99"))!;
    expect((assetCall as unknown as [string, RequestInit])[1].redirect).toBe("manual");
  });

  it("download is a 404 when there is no release, and never forwards a non-https redirect", async () => {
    await setup();
    const { GET } = await import("@/app/api/integrations/app-update/download/route");
    expect((await GET(req("app-update/download"), undefined as never)).status).toBe(404);

    process.env.APP_RELEASES_TOKEN = "ghp_test";
    const { resetAppUpdateCacheForTests } = await import("@/lib/app-update");
    resetAppUpdateCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/releases/latest")
          ? new Response(JSON.stringify(release()), { status: 200 })
          : new Response(null, { status: 302, headers: { location: "http://insecure.example.com/x" } })
      )
    );
    expect((await GET(req("app-update/download"), undefined as never)).status).toBe(500);
  });
});


// ── GET /api/integrations/changes ──────────────────────────────────────────

describe("GET /api/integrations/changes", () => {
  const TEST_KEY = "changes-route-api-key";
  let userId: string;

  function req(query = "", headers: Record<string, string> = { authorization: `Bearer ${TEST_KEY}` }) {
    return new NextRequest(`http://localhost/api/integrations/changes${query}`, { headers });
  }

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Changes User", email: "changes@example.com", password: "hash", isActive: true });
    userId = user._id.toString();
    await ApiKey.create({ user: user._id, label: "test", keyHash: hashKey(TEST_KEY), lastFour: TEST_KEY.slice(-4) });
  });

  it("is 401 without a key", async () => {
    const { GET } = await import("@/app/api/integrations/changes/route");
    const res = await GET(req("", {}), undefined as never);
    expect(res.status).toBe(401);
  });

  it("returns now and no changes without a valid since, uncached", async () => {
    const { GET } = await import("@/app/api/integrations/changes/route");
    const before = Date.now();
    for (const q of ["", "?since=abc"]) {
      const res = await GET(req(q), undefined as never);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(json.success).toBe(true);
      expect(json.data.changed).toEqual([]);
      expect(json.data.now).toBeGreaterThanOrEqual(before);
    }
  });

  it("reports only this user's resources updated after since", async () => {
    const { default: Goal } = await import("@/models/Goal");
    const { default: Notification } = await import("@/models/Notification");
    const { default: User } = await import("@/models/User");
    const other = await User.create({ name: "Other", email: "other-c@example.com", password: "hash" });
    const since = Date.now() - 1000;
    await Goal.create({ user: userId, name: "Trip", targetAmount: 1000 });
    await Notification.create({ user: other._id, type: "budget_alert", title: "x", body: "y" });

    const { GET } = await import("@/app/api/integrations/changes/route");
    const json = await (await GET(req(`?since=${since}`), undefined as never)).json();
    expect(json.data.changed).toEqual(["goals"]);

    const later = await (await GET(req(`?since=${Date.now() + 60_000}`), undefined as never)).json();
    expect(later.data.changed).toEqual([]);
  });

  it("reports repayments and credit statements", async () => {
    const { default: Repayment } = await import("@/models/Repayment");
    const { default: CreditStatement } = await import("@/models/CreditStatement");
    const { default: Account } = await import("@/models/Account");
    const { default: Loan } = await import("@/models/Loan");
    const since = Date.now() - 1000;
    const account = await Account.create({ user: userId, name: "Card", type: "credit_card", balance: 0, currency: "INR" });
    const loan = await Loan.create({ user: userId, counterparty: "Sam", direction: "given", principalAmount: 1000, remainingAmount: 1000, startDate: new Date() });
    await Repayment.collection.insertOne({ user: new mongoose.Types.ObjectId(userId), loan: loan._id, amount: 100, date: new Date(), updatedAt: new Date() });
    await CreditStatement.collection.insertOne({ user: new mongoose.Types.ObjectId(userId), account: account._id, updatedAt: new Date() });

    const { GET } = await import("@/app/api/integrations/changes/route");
    const json = await (await GET(req(`?since=${since}`), undefined as never)).json();
    expect(json.data.changed).toEqual(expect.arrayContaining(["repayments", "statements"]));
  });

  it("reports a changed spend limit", async () => {
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    const since = Date.now() - 1000;
    await SpendLimit.create({ user: userId, dailyAmount: 100000 });
    const { GET } = await import("@/app/api/integrations/changes/route");
    const json = await (await GET(req(`?since=${since}`), undefined as never)).json();
    expect(json.data.changed).toContain("spendLimits");
  });
});

// ── PATCH and DELETE /api/integrations/{budgets,goals}/[id] ────────────────

describe("integration budget and goal edit and delete", () => {
  const KEY = "test-budget-goal-api-key";
  let userId: string;
  let otherUserId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "BG User", email: `bg${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `bgo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  function req(path: string, method: "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": `bg-key-${n}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function makeBudget(user: string = userId) {
    const { default: Budget } = await import("@/models/Budget");
    return Budget.create({ user, category: "food", month: 10, year: 2026, limitAmount: 500000 });
  }
  async function makeGoal(user: string = userId, over: Record<string, unknown> = {}) {
    const { default: Goal } = await import("@/models/Goal");
    return Goal.create({ user, name: "Trip", targetAmount: 100000, savedAmount: 0, ...over });
  }

  it("PATCH budget updates the limit, appends a ledger block and replays on the same key", async () => {
    const { PATCH } = await import("@/app/api/integrations/budgets/[id]/route");
    const { default: LedgerBlock } = await import("@/models/LedgerBlock");
    const budget = await makeBudget();
    const id = budget._id.toString();

    const first = await PATCH(req(`budgets/${id}`, "PATCH", { limitAmount: 700000, alertAt: 90 }, { "idempotency-key": "same" }), ctx(id));
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(firstJson.data.limitAmount).toBe(700000);
    expect(firstJson.data.alertAt).toBe(90);
    expect(await LedgerBlock.countDocuments({ scope: "budget", action: "update" })).toBe(1);

    const replay = await PATCH(req(`budgets/${id}`, "PATCH", { limitAmount: 700000, alertAt: 90 }, { "idempotency-key": "same" }), ctx(id));
    expect(replay.status).toBe(200);
    expect(await LedgerBlock.countDocuments({ scope: "budget", action: "update" })).toBe(1);
  });

  it("PATCH budget rejects bad data, a missing key and a bad id", async () => {
    const { PATCH } = await import("@/app/api/integrations/budgets/[id]/route");
    const id = (await makeBudget())._id.toString();

    const bad = await PATCH(req(`budgets/${id}`, "PATCH", { limitAmount: -1 }), ctx(id));
    expect(bad.status).toBe(400);
    const noKey = new NextRequest(`http://localhost/api/integrations/budgets/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ limitAmount: 1000 }),
    });
    expect((await PATCH(noKey, ctx(id))).status).toBe(400);
    expect((await PATCH(req("budgets/nope", "PATCH", { limitAmount: 1000 }), ctx("nope"))).status).toBe(400);
  });

  it("PATCH and DELETE budget return 404 for someone else's or a missing budget", async () => {
    const { PATCH, DELETE } = await import("@/app/api/integrations/budgets/[id]/route");
    const theirs = (await makeBudget(otherUserId))._id.toString();
    const missing = "64f000000000000000000000";

    expect((await PATCH(req(`budgets/${theirs}`, "PATCH", { limitAmount: 1000 }), ctx(theirs))).status).toBe(404);
    expect((await DELETE(req(`budgets/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);
    expect((await DELETE(req(`budgets/${missing}`, "DELETE"), ctx(missing))).status).toBe(404);
  });

  it("DELETE budget soft deletes it and a second delete is 404", async () => {
    const { DELETE } = await import("@/app/api/integrations/budgets/[id]/route");
    const { default: Budget } = await import("@/models/Budget");
    const id = (await makeBudget())._id.toString();

    const res = await DELETE(req(`budgets/${id}`, "DELETE"), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id, deleted: true });
    const stored = await Budget.findById(id).lean<{ isDeleted: boolean }>();
    expect(stored?.isDeleted).toBe(true);
    expect((await DELETE(req(`budgets/${id}`, "DELETE"), ctx(id))).status).toBe(404);
  });

  it("PATCH goal updates it and fires goal_reached once when it completes", async () => {
    const { PATCH } = await import("@/app/api/integrations/goals/[id]/route");
    const { default: Notification } = await import("@/models/Notification");
    const id = (await makeGoal())._id.toString();

    const half = await PATCH(req(`goals/${id}`, "PATCH", { savedAmount: 50000, name: "Big trip" }), ctx(id));
    const halfJson = await half.json();
    expect(half.status).toBe(200);
    expect(halfJson.data.name).toBe("Big trip");
    expect(halfJson.data.isCompleted).toBe(false);
    expect(await Notification.countDocuments({ type: "goal_reached" })).toBe(0);

    const done = await PATCH(req(`goals/${id}`, "PATCH", { savedAmount: 100000 }), ctx(id));
    expect(done.status).toBe(200);
    expect(await Notification.countDocuments({ type: "goal_reached" })).toBe(1);
  });

  it("PATCH goal keeps only one round-up goal per user", async () => {
    const { PATCH } = await import("@/app/api/integrations/goals/[id]/route");
    const { default: Goal } = await import("@/models/Goal");
    const first = await makeGoal(userId, { roundUpEnabled: true });
    const second = (await makeGoal(userId, { name: "Other" }))._id.toString();

    const res = await PATCH(req(`goals/${second}`, "PATCH", { roundUpEnabled: true }), ctx(second));
    expect(res.status).toBe(200);
    const reloaded = await Goal.findById(first._id).lean<{ roundUpEnabled: boolean }>();
    expect(reloaded?.roundUpEnabled).toBe(false);
  });

  it("PATCH and DELETE goal return 404 for someone else's goal, DELETE soft deletes", async () => {
    const { PATCH, DELETE } = await import("@/app/api/integrations/goals/[id]/route");
    const { default: Goal } = await import("@/models/Goal");
    const theirs = (await makeGoal(otherUserId))._id.toString();
    expect((await PATCH(req(`goals/${theirs}`, "PATCH", { name: "x" }), ctx(theirs))).status).toBe(404);
    expect((await DELETE(req(`goals/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);

    const mine = (await makeGoal())._id.toString();
    const res = await DELETE(req(`goals/${mine}`, "DELETE"), ctx(mine));
    expect(res.status).toBe(200);
    const stored = await Goal.findById(mine).lean<{ isDeleted: boolean }>();
    expect(stored?.isDeleted).toBe(true);
    expect((await PATCH(req(`goals/${mine}`, "PATCH", { name: "again" }), ctx(mine))).status).toBe(404);
  });

  it("rejects an invalid API key with 401", async () => {
    const { PATCH } = await import("@/app/api/integrations/budgets/[id]/route");
    const id = (await makeBudget())._id.toString();
    const res = await PATCH(req(`budgets/${id}`, "PATCH", { limitAmount: 1000 }, { authorization: "Bearer wrong" }), ctx(id));
    expect(res.status).toBe(401);
  });
});

// ── GET /api/integrations/credit-cards/* ───────────────────────────────────

describe("integration credit cards", () => {
  const KEY = "test-credit-card-api-key";
  let userId: string;
  let otherUserId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "CC User", email: `cc${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "CC Other", email: `cco${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  function req(path: string, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      headers: { authorization: `Bearer ${KEY}`, "x-request-n": String(n), ...headers },
    });
  }
  const ctx = (accountId: string) => ({ params: Promise.resolve({ accountId }) });

  async function makeCard(user: string, creditMeta: Record<string, unknown> | undefined, name = "HDFC Card") {
    const { default: Account } = await import("@/models/Account");
    return Account.create({ user, name, type: "credit_card", balance: 0, currency: "INR", creditMeta });
  }

  it("summary is empty with no cards", async () => {
    const { GET } = await import("@/app/api/integrations/credit-cards/summary/route");
    const res = await GET(req("credit-cards/summary"), undefined as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.cards).toEqual([]);
    expect(json.data.totalDebt).toBe(0);
  });

  it("summary lists configured and unconfigured cards with utilisation, and skips other users and other account types", async () => {
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const card = await makeCard(userId, { billingCycleDay: 1, paymentDueDay: 20, creditLimit: 1000000, minPaymentPct: 5, lastFourDigits: "1234" });
    await makeCard(userId, undefined, "Bare Card");
    await makeCard(otherUserId, { billingCycleDay: 1, paymentDueDay: 20, creditLimit: 500000 }, "Theirs");
    await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0, currency: "INR" });
    await Transaction.create({
      user: userId,
      account: card._id,
      type: "expense",
      amount: 250000,
      currency: "INR",
      category: "shopping",
      description: "tv",
      date: new Date(),
    });

    const { GET } = await import("@/app/api/integrations/credit-cards/summary/route");
    const res = await GET(req("credit-cards/summary"), undefined as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.cards).toHaveLength(2);
    const configured = json.data.cards.find((c: { name: string }) => c.name === "HDFC Card");
    expect(configured.lastFourDigits).toBe("1234");
    expect(configured.creditLimit).toBe(1000000);
    expect(configured.balance).toBeGreaterThan(0);
    expect(configured.utilization).toBeGreaterThan(0);
    const bare = json.data.cards.find((c: { name: string }) => c.name === "Bare Card");
    expect(bare.status).toBe("unconfigured");
    expect(json.data.totalCreditExposure).toBe(configured.balance);
  });

  it("statements returns the open cycle for a configured card", async () => {
    const card = await makeCard(userId, { billingCycleDay: 1, paymentDueDay: 20, creditLimit: 1000000, minPaymentPct: 5 });
    const id = card._id.toString();
    const { GET } = await import("@/app/api/integrations/credit-cards/[accountId]/statements/route");
    const res = await GET(req(`credit-cards/${id}/statements`), ctx(id));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json.data.statements)).toBe(true);
    expect(json.data.currentCycle.label).toBeTruthy();
    expect(typeof json.data.currentCycle.periodStart).toBe("string");
  });

  it("statements returns an empty list with a message when billing is not configured", async () => {
    const id = (await makeCard(userId, undefined))._id.toString();
    const { GET } = await import("@/app/api/integrations/credit-cards/[accountId]/statements/route");
    const json = await (await GET(req(`credit-cards/${id}/statements`), ctx(id))).json();
    expect(json.data.statements).toEqual([]);
    expect(json.data.currentCycle).toBeNull();
    expect(json.data.message).toBe("Billing cycle not configured");
  });

  it("statements rejects a bad id, an unknown or foreign card and a non-card account", async () => {
    const { default: Account } = await import("@/models/Account");
    const { GET } = await import("@/app/api/integrations/credit-cards/[accountId]/statements/route");
    expect((await GET(req("credit-cards/nope/statements"), ctx("nope"))).status).toBe(400);

    const missing = "64f000000000000000000000";
    expect((await GET(req(`credit-cards/${missing}/statements`), ctx(missing))).status).toBe(404);

    const theirs = (await makeCard(otherUserId, { billingCycleDay: 1, paymentDueDay: 20 }))._id.toString();
    expect((await GET(req(`credit-cards/${theirs}/statements`), ctx(theirs))).status).toBe(404);

    const cash = (await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0, currency: "INR" }))._id.toString();
    expect((await GET(req(`credit-cards/${cash}/statements`), ctx(cash))).status).toBe(400);
  });

  it("rejects an invalid API key with 401", async () => {
    const { GET } = await import("@/app/api/integrations/credit-cards/summary/route");
    const res = await GET(req("credit-cards/summary", { authorization: "Bearer wrong" }), undefined as never);
    expect(res.status).toBe(401);
  });
});

// ── POST /api/integrations/accounts and PATCH, DELETE .../accounts/[id] ────

describe("integration account create, edit and archive", () => {
  const KEY = "test-account-write-api-key";
  let userId: string;
  let otherUserId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Acc User", email: `acw${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `acwo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  function req(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": `acw-key-${n}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function makeAccount(user: string = userId, over: Record<string, unknown> = {}) {
    const { default: Account } = await import("@/models/Account");
    return Account.create({ user, name: "Wallet", type: "cash", balance: 5000, currency: "INR", ...over });
  }

  it("POST creates an account with its opening balance, a ledger block, and replays on the same key", async () => {
    const { POST } = await import("@/app/api/integrations/accounts/route");
    const { default: Account } = await import("@/models/Account");
    const { default: LedgerBlock } = await import("@/models/LedgerBlock");
    const body = { name: "HDFC", type: "bank", balance: 250000, smsLastFour: ["1234"] };

    const first = await POST(req("accounts", "POST", body, { "idempotency-key": "same" }), {});
    const json = await first.json();
    expect(first.status).toBe(201);
    expect(json.data.name).toBe("HDFC");
    expect(json.data.balance).toBe(250000);
    expect(json.data.smsLastFour).toEqual(["1234"]);
    expect(await LedgerBlock.countDocuments({ scope: "account", action: "create" })).toBe(1);

    const replay = await POST(req("accounts", "POST", body, { "idempotency-key": "same" }), {});
    expect((await replay.json()).data._id).toBe(json.data._id);
    expect(await Account.countDocuments({ user: userId })).toBe(1);
  });

  it("POST creates a credit card with card details", async () => {
    const { POST } = await import("@/app/api/integrations/accounts/route");
    const res = await POST(
      req("accounts", "POST", {
        name: "Visa",
        type: "credit_card",
        creditMeta: { creditLimit: 10000000, billingCycleDay: 5, paymentDueDay: 25, network: "visa", lastFourDigits: "4242" },
      }),
      {}
    );
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data.creditMeta.network).toBe("visa");
    expect(json.data.creditMeta.billingCycleDay).toBe(5);
  });

  it("POST rejects bad data, a missing key and a bad API key", async () => {
    const { POST } = await import("@/app/api/integrations/accounts/route");
    expect((await POST(req("accounts", "POST", { name: "", type: "nope" }), {})).status).toBe(400);
    const noKey = new NextRequest("http://localhost/api/integrations/accounts", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "A", type: "cash" }),
    });
    expect((await POST(noKey, {})).status).toBe(400);
    expect((await POST(req("accounts", "POST", { name: "A", type: "cash" }, { authorization: "Bearer wrong" }), {})).status).toBe(401);
  });

  it("PATCH renames, sets card details and ignores a balance field", async () => {
    const { PATCH } = await import("@/app/api/integrations/accounts/[id]/route");
    const { default: Account } = await import("@/models/Account");
    const { default: LedgerBlock } = await import("@/models/LedgerBlock");
    const id = (await makeAccount())._id.toString();

    const res = await PATCH(req(`accounts/${id}`, "PATCH", { name: "Pocket", color: "#112233", balance: 99999999 }), ctx(id));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.name).toBe("Pocket");
    expect(json.data.balance).toBe(5000);
    const stored = await Account.findById(id).lean<{ balance: number }>();
    expect(stored?.balance).toBe(5000);
    expect(await LedgerBlock.countDocuments({ scope: "account", action: "update" })).toBe(1);
  });

  it("PATCH rejects bad data and a bad id, and is 404 for another user's account", async () => {
    const { PATCH } = await import("@/app/api/integrations/accounts/[id]/route");
    const id = (await makeAccount())._id.toString();
    const theirs = (await makeAccount(otherUserId))._id.toString();

    expect((await PATCH(req(`accounts/${id}`, "PATCH", { smsLastFour: ["12"] }), ctx(id))).status).toBe(400);
    expect((await PATCH(req("accounts/nope", "PATCH", { name: "x" }), ctx("nope"))).status).toBe(400);
    expect((await PATCH(req(`accounts/${theirs}`, "PATCH", { name: "x" }), ctx(theirs))).status).toBe(404);
  });

  it("DELETE archives the account and a second delete is 404", async () => {
    const { DELETE } = await import("@/app/api/integrations/accounts/[id]/route");
    const { GET } = await import("@/app/api/integrations/accounts/route");
    const { default: Account } = await import("@/models/Account");
    const id = (await makeAccount())._id.toString();

    const res = await DELETE(req(`accounts/${id}`, "DELETE"), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id, archived: true });
    const stored = await Account.findById(id).lean<{ isArchived: boolean }>();
    expect(stored?.isArchived).toBe(true);
    expect((await DELETE(req(`accounts/${id}`, "DELETE"), ctx(id))).status).toBe(404);

    const list = await (await GET(new NextRequest("http://localhost/api/integrations/accounts", { headers: { authorization: `Bearer ${KEY}` } }), {})).json();
    expect(list.data).toHaveLength(0);
  });

  it("DELETE is 404 for another user's account", async () => {
    const { DELETE } = await import("@/app/api/integrations/accounts/[id]/route");
    const theirs = (await makeAccount(otherUserId))._id.toString();
    expect((await DELETE(req(`accounts/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);
  });
});

// ── GET and DELETE /api/integrations/transactions/recurring ────────────────

describe("integration recurring series", () => {
  const KEY = "test-recurring-api-key";
  let userId: string;
  let accountId: string;
  let actor: { id: string; name: string; email: string; role: string };
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Rec User", email: `rec${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    userId = user._id.toString();
    accountId = account._id.toString();
    actor = { id: userId, name: user.name, email: user.email, role: "user" };
  });

  function req(path: string, method: "GET" | "DELETE" = "GET", headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/transactions/recurring${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, ...(method === "DELETE" ? { "idempotency-key": `rec-key-${n}` } : {}), ...headers },
    });
  }
  const ctx = (recurringId: string) => ({ params: Promise.resolve({ recurringId }) });

  async function makeSeries(count = 3) {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Transaction } = await import("@/models/Transaction");
    await createTransaction({
      userId,
      actor,
      accountId,
      type: "expense",
      amount: 2000,
      currency: "INR",
      category: "Rent",
      tags: [],
      isRecurring: true,
      recurrenceFrequency: "monthly",
      recurrenceCount: count,
      recurrenceLabel: "Rent",
      date: new Date().toISOString(),
    });
    const first = await Transaction.findOne({ user: userId, recurringId: { $exists: true } }).lean<{ recurringId: unknown }>();
    return String(first!.recurringId);
  }

  it("GET lists one row per series with counts and the next due date", async () => {
    const { GET } = await import("@/app/api/integrations/transactions/recurring/route");
    await makeSeries(3);
    const res = await GET(req(""), {});
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({ label: "Rent", amount: 2000, count: 3, paidCount: 0, remainingCount: 3, frequency: "monthly" });
  });

  it("GET is scoped to the caller and honours accountId", async () => {
    const { GET } = await import("@/app/api/integrations/transactions/recurring/route");
    await makeSeries(2);
    const none = await (await GET(req("?accountId=64f000000000000000000000"), {})).json();
    expect(none.data).toEqual([]);
    expect((await GET(req("?accountId=nope"), {})).status).toBe(400);

    const { default: Transaction } = await import("@/models/Transaction");
    const { default: User } = await import("@/models/User");
    const other = await User.create({ name: "O", email: `o${Date.now()}@x.com`, password: "hash", isActive: true });
    await Transaction.updateMany({}, { $set: { user: other._id } });
    expect((await (await GET(req(""), {})).json()).data).toEqual([]);
  });

  it("GET ?upcoming returns only unpaid installments due within 7 days", async () => {
    const { GET } = await import("@/app/api/integrations/transactions/recurring/route");
    await makeSeries(3);
    const json = await (await GET(req("?upcoming=5"), {})).json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].installmentIndex).toBe(0);
  });

  it("GET [recurringId] returns installments and a summary, 404 for an unknown series, 400 for a bad id", async () => {
    const { GET } = await import("@/app/api/integrations/transactions/recurring/[recurringId]/route");
    const id = await makeSeries(3);
    const res = await GET(req(`/${id}`), ctx(id));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.installments).toHaveLength(3);
    expect(json.data.series).toMatchObject({ recurringId: id, count: 3, paidCount: 0, remainingAmount: 6000, accountId });
    expect((await GET(req("/64f000000000000000000000"), ctx("64f000000000000000000000"))).status).toBe(404);
    expect((await GET(req("/nope"), ctx("nope"))).status).toBe(400);
  });

  it("DELETE cancels unpaid installments, keeps paid ones and replays on the same key", async () => {
    const { DELETE } = await import("@/app/api/integrations/transactions/recurring/[recurringId]/route");
    const { setInstallmentStatus } = await import("@/lib/transaction-service");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const id = await makeSeries(3);
    const firstRow = await Transaction.findOne({ recurringId: id, installmentIndex: 0 }).lean<{ _id: unknown }>();
    await setInstallmentStatus(userId, id, String(firstRow!._id), "paid", actor);

    const first = await DELETE(req(`/${id}`, "DELETE", { "idempotency-key": "same" }), ctx(id));
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(firstJson.data).toEqual({ recurringId: id, deletedCount: 2 });
    expect(await Transaction.countDocuments({ recurringId: id, isDeleted: { $ne: true } })).toBe(1);
    expect(await Transaction.countDocuments({ recurringId: id, recurrenceCancelled: true })).toBe(3);
    expect((await Account.findById(accountId))!.balance).toBe(-2000);

    const replay = await DELETE(req(`/${id}`, "DELETE", { "idempotency-key": "same" }), ctx(id));
    expect((await replay.json()).data.deletedCount).toBe(2);

    const again = await DELETE(req(`/${id}`, "DELETE"), ctx(id));
    expect((await again.json()).data.deletedCount).toBe(0);
  });

  it("DELETE needs an Idempotency-Key and a valid id, and rejects a bad API key", async () => {
    const { DELETE } = await import("@/app/api/integrations/transactions/recurring/[recurringId]/route");
    const id = await makeSeries(2);
    const noKey = new NextRequest(`http://localhost/api/integrations/transactions/recurring/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect((await DELETE(noKey, ctx(id))).status).toBe(400);
    expect((await DELETE(req("/nope", "DELETE"), ctx("nope"))).status).toBe(400);
    expect((await DELETE(req(`/${id}`, "DELETE", { authorization: "Bearer wrong" }), ctx(id))).status).toBe(401);
  });
});

// ── /api/integrations/stats and /api/integrations/notifications ────────────

describe("integration stats and notifications", () => {
  const KEY = "test-stats-notif-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "SN User", email: `sn${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `sno${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 0, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
  });

  function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": `sn-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function addTxn(type: "income" | "expense", amount: number, category: string, date: Date, extra: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({ user: userId, account: accountId, type, amount, currency: "INR", category, date, ...extra });
  }
  async function addNotification(user: string, over: Record<string, unknown> = {}) {
    const { default: Notification } = await import("@/models/Notification");
    return Notification.create({ user, type: "system", title: "Hi", body: "There", ...over });
  }

  it("GET stats returns the same numbers as getMonthlyStats, plus a daily series", async () => {
    const { GET } = await import("@/app/api/integrations/stats/route");
    const { getMonthlyStats } = await import("@/lib/stats-service");
    await addTxn("income", 500000, "salary", new Date(2026, 9, 1, 12));
    await addTxn("expense", 20000, "food", new Date(2026, 9, 3, 12));
    await addTxn("expense", 30000, "food", new Date(2026, 9, 3, 18));
    await addTxn("expense", 10000, "travel", new Date(2026, 9, 20, 12));
    await addTxn("expense", 99999, "food", new Date(2026, 8, 30, 12)); // other month

    const res = await GET(req("stats?month=10&year=2026"), undefined as never);
    const json = await res.json();
    const expected = await getMonthlyStats(userId, 2026, 10);
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ month: 10, year: 2026, ...expected });
    expect(json.data.income).toBe(500000);
    expect(json.data.expense).toBe(60000);
    expect(json.data.byCategory[0]).toEqual({ category: "food", total: 50000 });
    expect(json.data.daily).toHaveLength(31);
    expect(json.data.daily[2]).toEqual({ day: 3, income: 0, expense: 50000 });
    expect(json.data.daily.reduce((s: number, d: { expense: number }) => s + d.expense, 0)).toBe(60000);
    expect(json.data.history).toBeUndefined();
  });

  it("GET stats history matches the web range route and ignores other users and unpaid installments", async () => {
    const { GET } = await import("@/app/api/integrations/stats/route");
    const { GET: RANGE } = await import("@/app/api/transactions/stats/range/route");
    const { default: Transaction } = await import("@/models/Transaction");
    await addTxn("expense", 1000, "food", new Date(2026, 8, 5, 12));
    await addTxn("expense", 2000, "food", new Date(2026, 9, 5, 12));
    await Transaction.create({ user: otherUserId, account: accountId, type: "expense", amount: 777, currency: "INR", category: "food", date: new Date(2026, 9, 5, 12) });
    await addTxn("expense", 5000, "rent", new Date(2026, 9, 6, 12), { recurringId: new mongoose.Types.ObjectId(), installmentStatus: "upcoming" });

    const res = await GET(req("stats?month=10&year=2026&months=2026-9,2026-10"), undefined as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.history.map((h: { month: number }) => h.month)).toEqual([9, 10]);
    expect(json.data.history[0].stats.expense).toBe(1000);
    expect(json.data.history[1].stats.expense).toBe(2000);

    sessionUser.current = { id: userId, name: "SN User", email: "x@x.com", role: "user" };
    const web = await RANGE(new NextRequest("http://localhost/api/transactions/stats/range?months=2026-9,2026-10"));
    expect((await web.json()).data).toEqual(json.data.history);
    sessionUser.current = null;
  });

  it("GET stats rejects bad month, bad months and a bad key", async () => {
    const { GET } = await import("@/app/api/integrations/stats/route");
    expect((await GET(req("stats?month=13&year=2026"), undefined as never)).status).toBe(400);
    expect((await GET(req("stats?month=1&year=2026&months=nope"), undefined as never)).status).toBe(400);
    expect((await GET(req("stats", "GET", undefined, { authorization: "Bearer wrong" }), undefined as never)).status).toBe(401);
  });

  it("GET notifications lists newest first with unread count, filters unread and caps the limit", async () => {
    const { GET } = await import("@/app/api/integrations/notifications/route");
    await addNotification(userId, { title: "old", isRead: true, createdAt: new Date(Date.now() - 60_000) });
    await addNotification(userId, { title: "new" });
    await addNotification(otherUserId, { title: "not mine" });

    const all = await (await GET(req("notifications"), undefined as never)).json();
    expect(all.data.items.map((i: { title: string }) => i.title)).toEqual(["new", "old"]);
    expect(all.data.total).toBe(2);
    expect(all.data.unreadCount).toBe(1);

    const unread = await (await GET(req("notifications?unread=true"), undefined as never)).json();
    expect(unread.data.items.map((i: { title: string }) => i.title)).toEqual(["new"]);

    const capped = await (await GET(req("notifications?limit=500"), undefined as never)).json();
    expect(capped.data.limit).toBe(50);
  });

  it("PATCH notification marks read and unread, replays on the same key, and is 404 for another user's", async () => {
    const { PATCH } = await import("@/app/api/integrations/notifications/[id]/route");
    const mine = (await addNotification(userId))._id.toString();
    const theirs = (await addNotification(otherUserId))._id.toString();

    const read = await PATCH(req(`notifications/${mine}`, "PATCH", {}, { "idempotency-key": "same" }), ctx(mine));
    expect(read.status).toBe(200);
    expect((await read.json()).data.isRead).toBe(true);
    const replay = await PATCH(req(`notifications/${mine}`, "PATCH", {}, { "idempotency-key": "same" }), ctx(mine));
    expect(replay.status).toBe(200);

    const unread = await PATCH(req(`notifications/${mine}`, "PATCH", { isRead: false }), ctx(mine));
    expect((await unread.json()).data.isRead).toBe(false);

    expect((await PATCH(req(`notifications/${theirs}`, "PATCH", {}), ctx(theirs))).status).toBe(404);
    expect((await PATCH(req("notifications/nope", "PATCH", {}), ctx("nope"))).status).toBe(400);
    expect((await PATCH(req(`notifications/${mine}`, "PATCH", { isRead: "yes" }), ctx(mine))).status).toBe(400);
  });

  it("POST read-all marks only this user's notifications read and needs an Idempotency-Key", async () => {
    const { POST } = await import("@/app/api/integrations/notifications/read-all/route");
    const { default: Notification } = await import("@/models/Notification");
    await addNotification(userId);
    await addNotification(userId);
    await addNotification(otherUserId);

    const noKey = new NextRequest("http://localhost/api/integrations/notifications/read-all", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect((await POST(noKey, undefined as never)).status).toBe(400);

    const res = await POST(req("notifications/read-all", "POST"), undefined as never);
    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ user: userId, isRead: false })).toBe(0);
    expect(await Notification.countDocuments({ user: otherUserId, isRead: false })).toBe(1);
  });
});

// ── /api/integrations/loans ────────────────────────────────────────────────

describe("integration loans and repayments", () => {
  const KEY = "test-loans-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Loan User", email: `ln${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `lno${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": `loan-key-${n}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const loanBody = (over: Record<string, unknown> = {}) => ({
    direction: "given",
    counterparty: "Ravi",
    principalAmount: 50000,
    startDate: new Date().toISOString(),
    ...over,
  });

  async function makeLoan(user: string = userId, over: Record<string, unknown> = {}) {
    const { default: Loan } = await import("@/models/Loan");
    return Loan.create({
      user,
      direction: "given",
      counterparty: "Ravi",
      principalAmount: 50000,
      remainingAmount: 50000,
      startDate: new Date(),
      ...over,
    });
  }

  it("POST creates a loan, with an account it books the principal, and replays on the same key", async () => {
    const { POST } = await import("@/app/api/integrations/loans/route");
    const { default: Loan } = await import("@/models/Loan");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");

    const body = loanBody({ accountId });
    const first = await POST(req("loans", "POST", body, { "idempotency-key": "same" }), {});
    const firstJson = await first.json();
    expect(first.status).toBe(201);
    expect(firstJson.data.remainingAmount).toBe(50000);

    const replay = await POST(req("loans", "POST", body, { "idempotency-key": "same" }), {});
    expect((await replay.json()).data._id).toBe(firstJson.data._id);
    expect(await Loan.countDocuments({})).toBe(1);
    expect(await Transaction.countDocuments({ category: "loan" })).toBe(1);
    const account = await Account.findById(accountId).lean<{ balance: number }>();
    expect(account?.balance).toBe(50000);
  });

  it("POST rejects bad data, a missing key, an unknown account and a bad API key", async () => {
    const { POST } = await import("@/app/api/integrations/loans/route");
    expect((await POST(req("loans", "POST", { counterparty: "" }), {})).status).toBe(400);
    const noKey = new NextRequest("http://localhost/api/integrations/loans", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(loanBody()),
    });
    expect((await POST(noKey, {})).status).toBe(400);
    expect((await POST(req("loans", "POST", loanBody({ accountId: "64f000000000000000000000" })), {})).status).toBe(404);
    expect((await POST(req("loans", "POST", loanBody(), { authorization: "Bearer wrong" }), {})).status).toBe(401);
  });

  it("GET lists only the caller's loans and filters by direction and isSettled", async () => {
    const { GET } = await import("@/app/api/integrations/loans/route");
    await makeLoan();
    await makeLoan(userId, { direction: "received", counterparty: "Bank", isSettled: true, remainingAmount: 0 });
    await makeLoan(otherUserId);

    const all = await (await GET(req("loans", "GET"), {})).json();
    expect(all.data).toHaveLength(2);
    const given = await (await GET(req("loans?direction=given", "GET"), {})).json();
    expect(given.data.map((l: { counterparty: string }) => l.counterparty)).toEqual(["Ravi"]);
    const settled = await (await GET(req("loans?isSettled=true", "GET"), {})).json();
    expect(settled.data.map((l: { counterparty: string }) => l.counterparty)).toEqual(["Bank"]);
  });

  it("GET, PATCH and DELETE by id are 404 for someone else's loan and 400 for a bad id", async () => {
    const { GET, PATCH, DELETE } = await import("@/app/api/integrations/loans/[id]/route");
    const theirs = (await makeLoan(otherUserId))._id.toString();
    expect((await GET(req(`loans/${theirs}`, "GET"), ctx(theirs))).status).toBe(404);
    expect((await PATCH(req(`loans/${theirs}`, "PATCH", { counterparty: "x" }), ctx(theirs))).status).toBe(404);
    expect((await DELETE(req(`loans/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);
    expect((await GET(req("loans/nope", "GET"), ctx("nope"))).status).toBe(400);
  });

  it("PATCH updates a loan and appends a ledger block", async () => {
    const { PATCH } = await import("@/app/api/integrations/loans/[id]/route");
    const { default: LedgerBlock } = await import("@/models/LedgerBlock");
    const id = (await makeLoan())._id.toString();

    const res = await PATCH(req(`loans/${id}`, "PATCH", { counterparty: "Ravi K", interestRate: 5 }), ctx(id));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.counterparty).toBe("Ravi K");
    expect(json.data.interestRate).toBe(5);
    expect(await LedgerBlock.countDocuments({ scope: "loan", action: "update" })).toBe(1);
    expect((await PATCH(req(`loans/${id}`, "PATCH", { interestRate: 500 }), ctx(id))).status).toBe(400);
  });

  it("repayments reduce remainingAmount, settle the loan, and with an account move the balance", async () => {
    const { POST, GET } = await import("@/app/api/integrations/loans/[id]/repayments/route");
    const { default: Loan } = await import("@/models/Loan");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const id = (await makeLoan())._id.toString();
    const date = new Date().toISOString();

    const first = await POST(req(`loans/${id}/repayments`, "POST", { amount: 20000, date, accountId }), ctx(id));
    const firstJson = await first.json();
    expect(first.status).toBe(201);
    expect(firstJson.data.isSettled).toBe(false);
    let loan = await Loan.findById(id).lean<{ remainingAmount: number; isSettled: boolean }>();
    expect(loan?.remainingAmount).toBe(30000);
    const account = await Account.findById(accountId).lean<{ balance: number }>();
    expect(account?.balance).toBe(120000);
    expect(await Transaction.countDocuments({ category: "loan_repayment" })).toBe(1);

    const last = await POST(req(`loans/${id}/repayments`, "POST", { amount: 99999, date }), ctx(id));
    expect((await last.json()).data.isSettled).toBe(true);
    loan = await Loan.findById(id).lean<{ remainingAmount: number; isSettled: boolean }>();
    expect(loan?.remainingAmount).toBe(0);
    expect(loan?.isSettled).toBe(true);

    const list = await (await GET(req(`loans/${id}/repayments`, "GET"), ctx(id))).json();
    expect(list.data).toHaveLength(2);
  });

  it("repayment POST replays on the same key and rejects bad input", async () => {
    const { POST } = await import("@/app/api/integrations/loans/[id]/repayments/route");
    const { default: Repayment } = await import("@/models/Repayment");
    const { default: Loan } = await import("@/models/Loan");
    const id = (await makeLoan())._id.toString();
    const body = { amount: 10000, date: new Date().toISOString() };

    await POST(req(`loans/${id}/repayments`, "POST", body, { "idempotency-key": "rep" }), ctx(id));
    const replay = await POST(req(`loans/${id}/repayments`, "POST", body, { "idempotency-key": "rep" }), ctx(id));
    expect(replay.status).toBe(201);
    expect(await Repayment.countDocuments({})).toBe(1);
    const loan = await Loan.findById(id).lean<{ remainingAmount: number }>();
    expect(loan?.remainingAmount).toBe(40000);

    expect((await POST(req(`loans/${id}/repayments`, "POST", { amount: -5, date: body.date }), ctx(id))).status).toBe(400);
    expect((await POST(req(`loans/${id}/repayments`, "POST", { amount: 5, date: "nope" }), ctx(id))).status).toBe(400);
    const missing = "64f000000000000000000000";
    expect((await POST(req(`loans/${missing}/repayments`, "POST", body), ctx(missing))).status).toBe(404);
    expect((await POST(req(`loans/${id}/repayments`, "POST", { ...body, accountId: missing }), ctx(id))).status).toBe(404);
  });

  it("DELETE reverses the principal's balance effect and soft deletes loan, repayments and transactions", async () => {
    const { POST: create } = await import("@/app/api/integrations/loans/route");
    const { POST: repay } = await import("@/app/api/integrations/loans/[id]/repayments/route");
    const { DELETE } = await import("@/app/api/integrations/loans/[id]/route");
    const { default: Loan } = await import("@/models/Loan");
    const { default: Account } = await import("@/models/Account");
    const { default: Repayment } = await import("@/models/Repayment");
    const { default: Transaction } = await import("@/models/Transaction");

    const created = await (await create(req("loans", "POST", loanBody({ accountId })), {})).json();
    const id = created.data._id as string;
    await repay(req(`loans/${id}/repayments`, "POST", { amount: 10000, date: new Date().toISOString(), accountId }), ctx(id));

    const res = await DELETE(req(`loans/${id}`, "DELETE"), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id, deleted: true });
    const stored = await Loan.findById(id).lean<{ isDeleted: boolean }>();
    expect(stored?.isDeleted).toBe(true);
    expect(await Repayment.countDocuments({ isDeleted: { $ne: true } })).toBe(0);
    expect(await Transaction.countDocuments({ isDeleted: { $ne: true } })).toBe(0);
    const account = await Account.findById(accountId).lean<{ balance: number }>();
    expect(account?.balance).toBe(100000);
    expect((await DELETE(req(`loans/${id}`, "DELETE"), ctx(id))).status).toBe(404);
  });
});

// ── daily and weekly spend limits ──────────────────────────────────────────

describe("dayWindow", () => {
  it("starts the day at the user's midnight, not UTC midnight", async () => {
    const { dayWindow } = await import("@/lib/spend-limit-time");
    // 01:30 on 24 Oct in Kolkata (UTC+5:30) is 20:00 on 23 Oct UTC.
    const w = dayWindow(new Date("2026-10-23T20:00:00Z"), "Asia/Kolkata", 0);
    expect(w.dayStart.toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(w.dayEnd.toISOString()).toBe("2026-10-24T18:30:00.000Z");
    expect(w.yesterdayStart.toISOString()).toBe("2026-10-22T18:30:00.000Z");
    // 24 Oct 2026 is a Saturday; the week starts on Sunday 18 Oct.
    expect(w.weekStart.toISOString()).toBe("2026-10-17T18:30:00.000Z");
    expect(w.daysLeftInMonth).toBe(8);
  });

  it("honours the week start preference and falls back on an unknown zone", async () => {
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const monday = dayWindow(new Date("2026-10-23T10:00:00Z"), "Asia/Kolkata", 1);
    expect(monday.weekStart.toISOString()).toBe("2026-10-18T18:30:00.000Z");
    const fallback = dayWindow(new Date("2026-10-23T10:00:00Z"), "Not/AZone", 0);
    expect(fallback.dayStart.toISOString()).toBe("2026-10-22T18:30:00.000Z");
  });

  it("handles a zone behind UTC", async () => {
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const w = dayWindow(new Date("2026-10-23T03:00:00Z"), "America/New_York", 0);
    // 23:00 on 22 Oct in New York (EDT, UTC-4).
    expect(w.dayStart.toISOString()).toBe("2026-10-22T04:00:00.000Z");
  });
});

describe("spend limit history", () => {
  const day = (iso: string) => new Date(iso);
  const hist = [
    { from: "1970-01-01T00:00:00.000Z", dailyAmount: null, weeklyAmount: null },
    { from: "2026-10-10T18:30:00.000Z", dailyAmount: 100000, weeklyAmount: 500000 },
    { from: "2026-10-20T18:30:00.000Z", dailyAmount: 50000, weeklyAmount: 500000 },
  ];

  it("limitOn picks the last entry that starts at or before the date", async () => {
    const { limitOn } = await import("@/lib/spend-limit");
    const current = { dailyAmount: 50000, weeklyAmount: 500000 };
    expect(limitOn(hist, current, day("2026-10-05T00:00:00Z")).dailyAmount).toBeNull();
    expect(limitOn(hist, current, day("2026-10-10T18:29:59.999Z")).dailyAmount).toBeNull();
    expect(limitOn(hist, current, day("2026-10-10T18:30:00Z")).dailyAmount).toBe(100000);
    expect(limitOn(hist, current, day("2026-10-20T18:29:59Z")).dailyAmount).toBe(100000);
    expect(limitOn(hist, current, day("2026-10-25T00:00:00Z")).dailyAmount).toBe(50000);
  });

  it("with no history the current amounts count for every day", async () => {
    const { limitOn } = await import("@/lib/spend-limit");
    const current = { dailyAmount: 70000, weeklyAmount: null };
    expect(limitOn([], current, day("2001-01-01T00:00:00Z"))).toEqual(current);
    expect(limitOn([], current, day("2030-01-01T00:00:00Z"))).toEqual(current);
  });

  it("recordLimitChange: first change keeps the old value from the epoch", async () => {
    const { recordLimitChange } = await import("@/lib/spend-limit");
    const out = recordLimitChange([], { dailyAmount: 70000, weeklyAmount: null }, { dailyAmount: 90000, weeklyAmount: null }, day("2026-10-23T18:30:00Z"));
    expect(out).toEqual([
      { from: "1970-01-01T00:00:00.000Z", dailyAmount: 70000, weeklyAmount: null },
      { from: "2026-10-23T18:30:00.000Z", dailyAmount: 90000, weeklyAmount: null },
    ]);
  });

  it("recordLimitChange: same day replaces, a return to the previous value drops the entry", async () => {
    const { recordLimitChange } = await import("@/lib/spend-limit");
    const start = day("2026-10-23T18:30:00Z");
    const one = recordLimitChange([], { dailyAmount: 70000, weeklyAmount: null }, { dailyAmount: 90000, weeklyAmount: null }, start);
    const two = recordLimitChange(one, { dailyAmount: 90000, weeklyAmount: null }, { dailyAmount: 40000, weeklyAmount: null }, start);
    expect(two).toHaveLength(2);
    expect(two[1].dailyAmount).toBe(40000);
    const back = recordLimitChange(two, { dailyAmount: 40000, weeklyAmount: null }, { dailyAmount: 70000, weeklyAmount: null }, start);
    expect(back).toEqual([{ from: "1970-01-01T00:00:00.000Z", dailyAmount: 70000, weeklyAmount: null }]);
  });

  it("an edit just before and just after local midnight lands on the right day", async () => {
    const { recordLimitChange } = await import("@/lib/spend-limit");
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const before = { dailyAmount: 100000, weeklyAmount: null };
    const next = { dailyAmount: 50000, weeklyAmount: null };
    // 23:50 on 23 Oct and 00:10 on 24 Oct in Kolkata (UTC+5:30).
    const late = dayWindow(new Date("2026-10-23T18:20:00Z"), "Asia/Kolkata", 0).dayStart;
    const early = dayWindow(new Date("2026-10-23T18:40:00Z"), "Asia/Kolkata", 0).dayStart;
    expect(recordLimitChange([], before, next, late).at(-1)?.from).toBe("2026-10-22T18:30:00.000Z");
    expect(recordLimitChange([], before, next, early).at(-1)?.from).toBe("2026-10-23T18:30:00.000Z");
    // 23:50 on 22 Oct in New York (EDT, UTC-4) is still 22 Oct there.
    const ny = dayWindow(new Date("2026-10-23T03:50:00Z"), "America/New_York", 0).dayStart;
    expect(recordLimitChange([], before, next, ny).at(-1)?.from).toBe("2026-10-22T04:00:00.000Z");
  });
});

describe("spend limits", () => {
  const KEY = "test-spend-limit-api-key";
  let userId: string;
  let accountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Limit User", email: `sl${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 1000000, currency: "INR" });
    userId = user._id.toString();
    accountId = account._id.toString();
  });

  async function spend(amount: number, extra: Record<string, unknown> = {}, when = new Date()) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({
      user: userId,
      account: accountId,
      type: "expense",
      amount,
      category: "food",
      date: when,
      ...extra,
    });
  }

  function req(method: "GET" | "PUT", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest("http://localhost/api/integrations/spend-limit", {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `sl-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("has no limit until one is set, then reports today and the week", async () => {
    const { GET, PUT } = await import("@/app/api/integrations/spend-limit/route");
    const empty = await (await GET(req("GET"), undefined as never)).json();
    expect(empty.data.today).toEqual({ spent: 0, limit: null, left: null, percent: null });
    expect(empty.data.settings.dailyAmount).toBeNull();

    await spend(30000);
    const set = await PUT(req("PUT", { dailyAmount: 100000, weeklyAmount: 500000 }), undefined as never);
    expect(set.status).toBe(200);
    const json = await set.json();
    expect(json.data.today).toEqual({ spent: 30000, limit: 100000, left: 70000, percent: 30 });
    expect(json.data.week.limit).toBe(500000);
    expect(json.data.week.spent).toBeGreaterThanOrEqual(30000);
  });

  it("counts only expenses: not transfers, recurring bills, excluded categories or voided rows", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { default: Types } = await import("mongoose").then((m) => ({ default: m.Types }));
    await spend(10000);
    await spend(20000, { type: "transfer" });
    await spend(30000, { recurringId: new Types.ObjectId(), installmentStatus: "paid" });
    await spend(40000, { category: "rent" });
    await spend(50000, { reviewStatus: "voided" });
    await spend(60000, { isDeleted: true });
    const res = await PUT(req("PUT", { dailyAmount: 100000, excludeCategories: ["rent"] }), undefined as never);
    expect((await res.json()).data.today.spent).toBe(10000);
  });

  it("clears a limit with null, and a paused limit shows no limit", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    await PUT(req("PUT", { dailyAmount: 100000 }), undefined as never);
    const paused = await (
      await PUT(req("PUT", { pausedUntil: new Date(Date.now() + 86_400_000).toISOString() }), undefined as never)
    ).json();
    expect(paused.data.paused).toBe(true);
    expect(paused.data.today.limit).toBeNull();
    expect(paused.data.settings.dailyAmount).toBe(100000);

    const resumed = await (await PUT(req("PUT", { pausedUntil: null }), undefined as never)).json();
    expect(resumed.data.paused).toBe(false);
    expect(resumed.data.today.limit).toBe(100000);
    const cleared = await (await PUT(req("PUT", { dailyAmount: null }), undefined as never)).json();
    expect(cleared.data.settings.dailyAmount).toBeNull();
  });

  it("rollover moves yesterday's unspent amount into today's limit", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const win = dayWindow(new Date(), "Asia/Kolkata", 0);
    await spend(25000, {}, new Date(win.yesterdayStart.getTime() + 3600_000));
    // The limit was already in force yesterday.
    const { updateSpendLimit } = await import("@/lib/spend-limit");
    await updateSpendLimit(userId, { dailyAmount: 100000 }, new Date(win.yesterdayStart.getTime() + 1800_000));
    const off = await (await PUT(req("PUT", { alertAt: 80 }), undefined as never)).json();
    expect(off.data.today.limit).toBe(100000);
    const on = await (await PUT(req("PUT", { rollover: true }), undefined as never)).json();
    expect(on.data.today.limit).toBe(175000);
    // A limit first set today has no yesterday to roll over from.
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    await SpendLimit.deleteMany({ user: userId });
    const fresh = await (await PUT(req("PUT", { dailyAmount: 100000, rollover: true }), undefined as never)).json();
    expect(fresh.data.today.limit).toBe(100000);
  });

  it("a limit change applies from today: earlier days keep the limit they had", async () => {
    const { updateSpendLimit, limitOn, getSpendLimitStatus } = await import("@/lib/spend-limit");
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const now = new Date();
    const win = dayWindow(now, "Asia/Kolkata", 0);
    const twoDaysAgo = new Date(win.dayStart.getTime() - 36 * 3600_000);

    // Set 1,000 two days ago, then change it to 500 today.
    await updateSpendLimit(userId, { dailyAmount: 100000 }, twoDaysAgo);
    const changed = await updateSpendLimit(userId, { dailyAmount: 50000 }, now);

    expect(changed.today.limit).toBe(50000);
    expect(changed.settings.dailyAmount).toBe(50000);
    expect(changed.history.map((h) => [h.from, h.dailyAmount])).toEqual([
      ["1970-01-01T00:00:00.000Z", null],
      [dayWindow(twoDaysAgo, "Asia/Kolkata", 0).dayStart.toISOString(), 100000],
      [win.dayStart.toISOString(), 50000],
    ]);
    const current = { dailyAmount: 50000, weeklyAmount: null };
    expect(limitOn(changed.history, current, new Date(win.dayStart.getTime() - 1)).dailyAmount).toBe(100000);
    expect(limitOn(changed.history, current, win.dayStart).dailyAmount).toBe(50000);
    expect(limitOn(changed.history, current, new Date(0)).dailyAmount).toBeNull();

    // And the GET route returns the same history.
    const { GET } = await import("@/app/api/integrations/spend-limit/route");
    const got = await (await GET(req("GET"), undefined as never)).json();
    expect(got.data.history).toEqual(changed.history);
    expect((await getSpendLimitStatus(userId)).history).toEqual(changed.history);
  });

  it("two changes on the same day leave one entry for that day", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    await PUT(req("PUT", { dailyAmount: 100000 }), undefined as never);
    const second = await (await PUT(req("PUT", { dailyAmount: 80000 }), undefined as never)).json();
    const third = await (await PUT(req("PUT", { dailyAmount: 60000, weeklyAmount: 400000 }), undefined as never)).json();
    expect(second.data.history.filter((h: { from: string }) => h.from !== "1970-01-01T00:00:00.000Z")).toHaveLength(1);
    const today = third.data.history.at(-1);
    expect(today).toMatchObject({ dailyAmount: 60000, weeklyAmount: 400000 });
    expect(third.data.history).toHaveLength(2);
  });

  it("other settings do not add history, and a limit set before history has none", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    await SpendLimit.create({ user: userId, dailyAmount: 70000 }); // as written before history existed
    const status = await (await PUT(req("PUT", { alertAt: 90, excludeCategories: ["rent"] }), undefined as never)).json();
    expect(status.data.history).toEqual([]);
    expect(status.data.today.limit).toBe(70000);
    // The first amount change then keeps the old value for earlier days.
    const changed = await (await PUT(req("PUT", { dailyAmount: 90000 }), undefined as never)).json();
    expect(changed.data.history[0]).toEqual({ from: "1970-01-01T00:00:00.000Z", dailyAmount: 70000, weeklyAmount: null });
    expect(changed.data.history.at(-1).dailyAmount).toBe(90000);
  });

  it("changing one user's limit never touches another's history", async () => {
    const { updateSpendLimit } = await import("@/lib/spend-limit");
    const { default: User } = await import("@/models/User");
    const other = await User.create({ name: "Other", email: `other${Date.now()}@x.com`, password: "hash", isActive: true });
    const before = await updateSpendLimit(other._id.toString(), { dailyAmount: 11100 });
    await updateSpendLimit(userId, { dailyAmount: 22200 });
    await updateSpendLimit(userId, { dailyAmount: 33300 });
    const after = await updateSpendLimit(other._id.toString(), { alertAt: 70 });
    expect(after.history).toEqual(before.history);
    expect(after.settings.dailyAmount).toBe(11100);
  });

  it("rollover measures yesterday against the limit yesterday had", async () => {
    const { updateSpendLimit } = await import("@/lib/spend-limit");
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const now = new Date();
    const win = dayWindow(now, "Asia/Kolkata", 0);
    // Yesterday the limit was 1,000 and 250 was spent; today it is 500 with rollover.
    await spend(25000, {}, new Date(win.yesterdayStart.getTime() + 3600_000));
    await updateSpendLimit(userId, { dailyAmount: 100000, rollover: true }, new Date(win.dayStart.getTime() - 3600_000));
    const status = await updateSpendLimit(userId, { dailyAmount: 50000 }, now);
    // 500 + (1,000 - 250), not 500 + (500 - 250).
    expect(status.today.limit).toBe(125000);
  });

  it("computes safe to spend from budgets and upcoming bills, null without a budget", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { dayWindow } = await import("@/lib/spend-limit-time");
    const { default: Budget } = await import("@/models/Budget");
    const first = await (await PUT(req("PUT", { dailyAmount: 100000 }), undefined as never)).json();
    expect(first.data.safeToSpend).toBeNull();

    const win = dayWindow(new Date(), "Asia/Kolkata", 0);
    await Budget.create({ user: userId, category: "food", month: win.month, year: win.year, limitAmount: win.daysLeftInMonth * 10000 });
    const second = await (await PUT(req("PUT", { alertAt: 80 }), undefined as never)).json();
    expect(second.data.safeToSpend).toBe(10000);
  });

  it("validates input and needs an Idempotency-Key", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    expect((await PUT(req("PUT", { dailyAmount: -5 }), undefined as never)).status).toBe(400);
    expect((await PUT(req("PUT", { dailyAmount: 1.5 }), undefined as never)).status).toBe(400);
    const noKey = new NextRequest("http://localhost/api/integrations/spend-limit", {
      method: "PUT",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ dailyAmount: 100 }),
    });
    expect((await PUT(noKey, undefined as never)).status).toBe(400);
    expect((await PUT(req("PUT", { dailyAmount: 100 }, { authorization: "Bearer wrong" }), undefined as never)).status).toBe(401);
  });

  it("adds spendLimit to home and summary only once a limit is set", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { GET: home } = await import("@/app/api/integrations/home/route");
    const { GET: summary } = await import("@/app/api/integrations/summary/route");
    const homeReq = () => new NextRequest("http://localhost/api/integrations/home", { headers: { authorization: `Bearer ${KEY}` } });
    const summaryReq = () => new NextRequest("http://localhost/api/integrations/summary", { headers: { authorization: `Bearer ${KEY}` } });

    expect((await (await home(homeReq(), undefined as never)).json()).data.spendLimit).toBeNull();
    expect((await (await summary(summaryReq(), undefined as never)).json()).data.spendLimit).toBeNull();

    await PUT(req("PUT", { dailyAmount: 100000 }), undefined as never);
    expect((await (await home(homeReq(), undefined as never)).json()).data.spendLimit.today.limit).toBe(100000);
    expect((await (await summary(summaryReq(), undefined as never)).json()).data.spendLimit.today.limit).toBe(100000);
  });

  it("alerts once at the alert percentage and once at 100%, not on every expense", async () => {
    const { PUT } = await import("@/app/api/integrations/spend-limit/route");
    const { checkSpendLimitAlert } = await import("@/lib/spend-limit");
    const { default: Notification } = await import("@/models/Notification");
    await PUT(req("PUT", { dailyAmount: 100000, alertAt: 80 }), undefined as never);

    await spend(50000);
    await checkSpendLimitAlert(userId);
    expect(await Notification.countDocuments({ type: "budget_alert", "meta.kind": "spend_limit" })).toBe(0);

    await spend(35000);
    await checkSpendLimitAlert(userId);
    await checkSpendLimitAlert(userId);
    expect(await Notification.countDocuments({ type: "budget_alert", "meta.kind": "spend_limit", "meta.level": "near" })).toBe(1);

    await spend(20000);
    await checkSpendLimitAlert(userId);
    expect(await Notification.countDocuments({ type: "budget_alert", "meta.kind": "spend_limit", "meta.level": "over" })).toBe(1);
  });

  it("stores a time zone preference and rejects an unknown one", async () => {
    const { PATCH } = await import("@/app/api/me/preferences/route");
    const { default: User } = await import("@/models/User");
    sessionUser.current = { id: userId, name: "Limit User", email: "x@x.com", role: "user" };
    const patch = (body: unknown) =>
      PATCH(new NextRequest("http://localhost/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }));
    expect((await patch({ timezone: "Nowhere/Land" })).status).toBe(400);
    expect((await patch({ timezone: "America/New_York" })).status).toBe(200);
    const user = await User.findById(userId).lean<{ preferences: { timezone: string } }>();
    expect(user?.preferences.timezone).toBe("America/New_York");
    sessionUser.current = null;
  });
});

// ── end-of-day spend limit summary ─────────────────────────────────────────

describe("spend limit end-of-day summary", () => {
  let userId: string;
  let accountId: string;
  // 21:30 on 23 Oct in Kolkata, and 15:30 the same day.
  const evening = new Date("2026-10-23T16:00:00Z");
  const afternoon = new Date("2026-10-23T10:00:00Z");

  beforeEach(async () => {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "Sum User", email: `sum${Date.now()}@x.com`, password: "hash", isActive: true });
    const account = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 1000000, currency: "INR" });
    userId = user._id.toString();
    accountId = account._id.toString();
  });

  async function setLimit(over: Record<string, unknown> = { dailyAmount: 100000 }) {
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    await SpendLimit.create({ user: userId, ...over });
  }
  async function spend(amount: number, when = afternoon) {
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount, category: "food", date: when });
  }
  const notices = async () => {
    const { default: Notification } = await import("@/models/Notification");
    return Notification.find({ user: userId, "meta.kind": "spend_limit_summary" }).lean<Array<{ title: string; body: string }>>();
  };

  it("localHour reads the wall clock in the user's zone", async () => {
    const { localHour } = await import("@/lib/spend-limit-time");
    expect(localHour(evening, "Asia/Kolkata")).toBe(21);
    expect(localHour(evening, "America/New_York")).toBe(12);
  });

  it("waits for the user's evening, then sends once", async () => {
    const { sendSpendLimitSummary } = await import("@/lib/spend-limit");
    await setLimit();
    await spend(40000);
    expect(await sendSpendLimitSummary(userId, afternoon)).toBe(false);
    expect(await notices()).toHaveLength(0);

    expect(await sendSpendLimitSummary(userId, evening)).toBe(true);
    expect(await sendSpendLimitSummary(userId, new Date(evening.getTime() + 30 * 60_000))).toBe(false);
    const sent = await notices();
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Today: ₹400 of ₹1,000");
    expect(sent[0].body).toContain("under your daily limit");
  });

  it("says so when the limit was passed or nothing was spent", async () => {
    const { sendSpendLimitSummary } = await import("@/lib/spend-limit");
    await setLimit();
    await spend(130000);
    await sendSpendLimitSummary(userId, evening);
    expect((await notices())[0].body).toBe("You went over your daily limit by ₹300.");
  });

  it("sends a no-spend message on a quiet day", async () => {
    const { sendSpendLimitSummary } = await import("@/lib/spend-limit");
    await setLimit();
    await sendSpendLimitSummary(userId, evening);
    expect((await notices())[0].body).toContain("No spending today");
  });

  it("skips users with no daily limit or a paused limit", async () => {
    const { sendSpendLimitSummaries } = await import("@/lib/spend-limit");
    await setLimit({ weeklyAmount: 500000 });
    expect(await sendSpendLimitSummaries(evening)).toEqual({ checked: 0, sent: 0 });

    const { default: SpendLimit } = await import("@/models/SpendLimit");
    await SpendLimit.updateOne({ user: userId }, { $set: { dailyAmount: 100000, pausedUntil: new Date(evening.getTime() + 86_400_000) } });
    expect(await sendSpendLimitSummaries(evening)).toEqual({ checked: 1, sent: 0 });
    expect(await notices()).toHaveLength(0);
  });

  it("the cron route needs the secret and reports what it did", async () => {
    process.env.CRON_SECRET = "cron-secret-for-tests";
    const { GET } = await import("@/app/api/cron/spend-limit-summary/route");
    const call = (headers: Record<string, string> = {}) =>
      GET(new NextRequest("http://localhost/api/cron/spend-limit-summary", { headers }));
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await call({ authorization: "Bearer cron-secret-for-tests" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, checked: 0, sent: 0 });
  });
});

// ── GET /api/integrations/accounts: fields and archived ────────────────────

describe("GET /api/integrations/accounts details", () => {
  const KEY = "test-account-read-api-key";
  let userId: string;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Acc Read", email: `acr${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    await Account.create({
      user: userId,
      name: "Card",
      type: "credit_card",
      balance: 0,
      creditMeta: { creditLimit: 5000000, billingCycleDay: 5, paymentDueDay: 25, network: "visa", lastFourDigits: "4242" },
      smsLastFour: ["4242"],
    });
    await Account.create({ user: userId, name: "Old", type: "bank", balance: 100, isArchived: true });
  });

  const call = async (query = "") => {
    const { GET } = await import("@/app/api/integrations/accounts/route");
    return GET(
      new NextRequest(`http://localhost/api/integrations/accounts${query}`, { headers: { authorization: `Bearer ${KEY}` } }),
      {}
    );
  };

  it("returns the card details, SMS digits and isArchived, active accounts only by default", async () => {
    const json = await (await call()).json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      name: "Card",
      isArchived: false,
      smsLastFour: ["4242"],
      creditMeta: { creditLimit: 5000000, billingCycleDay: 5, paymentDueDay: 25, network: "visa", lastFourDigits: "4242" },
    });
  });

  it("includeArchived=true adds archived accounts after the active ones", async () => {
    const json = await (await call("?includeArchived=true")).json();
    expect(json.data.map((a: { name: string; isArchived: boolean }) => [a.name, a.isArchived])).toEqual([
      ["Card", false],
      ["Old", true],
    ]);
  });
});

// ── /api/integrations/transfers ────────────────────────────────────────────

describe("integration transfers between accounts", () => {
  const KEY = "test-transfers-api-key";
  let userId: string;
  let fromId: string;
  let toId: string;
  let otherAccountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Transfer User", email: `tf${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `tfo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const from = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    const to = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 5000, currency: "INR" });
    const theirs = await Account.create({ user: other._id, name: "Theirs", type: "bank", balance: 777, currency: "INR" });
    userId = user._id.toString();
    fromId = from._id.toString();
    toId = to._id.toString();
    otherAccountId = theirs._id.toString();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": `transfer-key-${n}`,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const balance = async (id: string) => {
    const { default: Account } = await import("@/models/Account");
    return (await Account.findById(id).lean<{ balance: number }>())!.balance;
  };
  const create = async (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/integrations/transfers/route");
    return POST(req("transfers", "POST", { fromAccountId: fromId, toAccountId: toId, amount: 20000, ...over }, headers), {});
  };

  it("POST moves the money, answers with both accounts, and replays on the same key", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const first = await create({ note: "Cash for the week" }, { "idempotency-key": "same" });
    const json = await first.json();
    expect(first.status).toBe(201);
    expect(json.data).toMatchObject({ type: "transfer", amount: 20000, fromAccountId: fromId, toAccountId: toId, note: "Cash for the week" });
    expect(await balance(fromId)).toBe(80000);
    expect(await balance(toId)).toBe(25000);

    const replay = await create({ note: "Cash for the week" }, { "idempotency-key": "same" });
    expect((await replay.json()).data.id).toBe(json.data.id);
    expect(await Transaction.countDocuments({ type: "transfer" })).toBe(1);
    expect(await balance(fromId)).toBe(80000);

    const reused = await create({ amount: 1 }, { "idempotency-key": "same" });
    expect(reused.status).toBe(409);
  });

  it("POST rejects bad data, a missing key, the same account twice, another user's account and a bad API key", async () => {
    const { POST } = await import("@/app/api/integrations/transfers/route");
    expect((await create({ amount: 0 })).status).toBe(400);
    expect((await create({ amount: 10.5 })).status).toBe(400);
    expect((await create({ toAccountId: fromId })).status).toBe(400);
    expect((await create({ toAccountId: "nope" })).status).toBe(400);
    const noKey = new NextRequest("http://localhost/api/integrations/transfers", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ fromAccountId: fromId, toAccountId: toId, amount: 100 }),
    });
    expect((await POST(noKey, {})).status).toBe(400);
    expect((await create({ toAccountId: otherAccountId })).status).toBe(404);
    expect((await create({ fromAccountId: otherAccountId })).status).toBe(404);
    expect((await create({}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect(await balance(fromId)).toBe(100000);
    expect(await balance(otherAccountId)).toBe(777);
  });

  it("a transfer is neither income nor spending in stats, budgets or limits", async () => {
    const { getRangeStats } = await import("@/lib/stats-service");
    await create({ amount: 30000 });
    const now = new Date();
    const [month] = await getRangeStats(userId, [{ year: now.getFullYear(), month: now.getMonth() + 1 }]);
    expect(month.stats.income).toBe(0);
    expect(month.stats.expense).toBe(0);
    expect(month.stats.byCategory).toEqual([]);
  });

  it("GET returns one transfer, and 404 for an unknown id or another user's", async () => {
    const { GET } = await import("@/app/api/integrations/transfers/[id]/route");
    const created = await (await create()).json();
    const ok = await GET(req("transfers/x", "GET"), ctx(created.data.id));
    expect((await ok.json()).data.amount).toBe(20000);
    expect((await GET(req("transfers/x", "GET"), ctx("64f000000000000000000000"))).status).toBe(404);
    expect((await GET(req("transfers/x", "GET"), ctx("nope"))).status).toBe(400);
  });

  it("PATCH changes the amount and fixes both balances", async () => {
    const { PATCH } = await import("@/app/api/integrations/transfers/[id]/route");
    const created = await (await create({ amount: 20000 })).json();
    const res = await PATCH(req("transfers/x", "PATCH", { amount: 30000, note: "More" }), ctx(created.data.id));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ amount: 30000, note: "More" });
    expect(await balance(fromId)).toBe(70000);
    expect(await balance(toId)).toBe(35000);
  });

  it("PATCH moves the destination to another account and puts the old one back", async () => {
    const { PATCH } = await import("@/app/api/integrations/transfers/[id]/route");
    const { default: Account } = await import("@/models/Account");
    const third = await Account.create({ user: userId, name: "Savings", type: "savings", balance: 0, currency: "INR" });
    const created = await (await create({ amount: 20000 })).json();
    const res = await PATCH(req("transfers/x", "PATCH", { toAccountId: third._id.toString() }), ctx(created.data.id));
    expect(res.status).toBe(200);
    expect(await balance(fromId)).toBe(80000);
    expect(await balance(toId)).toBe(5000);
    expect(await balance(third._id.toString())).toBe(20000);
  });

  it("PATCH refuses the same account, another user's account, an empty body and a missing transfer", async () => {
    const { PATCH } = await import("@/app/api/integrations/transfers/[id]/route");
    const created = await (await create()).json();
    const id = created.data.id;
    expect((await PATCH(req("transfers/x", "PATCH", { toAccountId: fromId }), ctx(id))).status).toBe(400);
    expect((await PATCH(req("transfers/x", "PATCH", { fromAccountId: toId }), ctx(id))).status).toBe(400);
    expect((await PATCH(req("transfers/x", "PATCH", { toAccountId: otherAccountId }), ctx(id))).status).toBe(404);
    expect((await PATCH(req("transfers/x", "PATCH", {}), ctx(id))).status).toBe(400);
    expect((await PATCH(req("transfers/x", "PATCH", { amount: 1 }), ctx("64f000000000000000000000"))).status).toBe(404);
    expect(await balance(fromId)).toBe(80000);
    expect(await balance(otherAccountId)).toBe(777);
  });

  it("PATCH and DELETE only act on transfers, not on an expense id", async () => {
    const { PATCH, DELETE } = await import("@/app/api/integrations/transfers/[id]/route");
    const { default: Transaction } = await import("@/models/Transaction");
    const expense = await Transaction.create({
      user: userId, account: fromId, type: "expense", amount: 500, category: "Food", date: new Date(),
    });
    expect((await PATCH(req("transfers/x", "PATCH", { amount: 1 }), ctx(String(expense._id)))).status).toBe(404);
    expect((await DELETE(req("transfers/x", "DELETE"), ctx(String(expense._id)))).status).toBe(404);
  });

  it("DELETE puts both balances back, replays, and a second delete is 404", async () => {
    const { DELETE } = await import("@/app/api/integrations/transfers/[id]/route");
    const { default: Transaction } = await import("@/models/Transaction");
    const created = await (await create({ amount: 20000 })).json();
    const id = created.data.id;
    const first = await DELETE(req("transfers/x", "DELETE", undefined, { "idempotency-key": "del" }), ctx(id));
    expect(first.status).toBe(200);
    expect((await first.json()).data).toEqual({ id, deleted: true });
    expect(await balance(fromId)).toBe(100000);
    expect(await balance(toId)).toBe(5000);
    expect((await Transaction.findById(id).lean<{ isDeleted?: boolean }>())?.isDeleted).toBe(true);

    const replay = await DELETE(req("transfers/x", "DELETE", undefined, { "idempotency-key": "del" }), ctx(id));
    expect(replay.status).toBe(200);
    expect((await DELETE(req("transfers/x", "DELETE"), ctx(id))).status).toBe(404);
    expect(await balance(fromId)).toBe(100000);
  });

  it("the transactions list shows incoming transfers only when asked", async () => {
    const { GET } = await import("@/app/api/integrations/transactions/route");
    await create({ amount: 20000 });
    const list = async (q: string) =>
      (await (await GET(req(`transactions?${q}`, "GET"), {})).json()).data.data as Array<{ type: string }>;
    expect(await list(`accountId=${toId}`)).toHaveLength(0);
    expect(await list(`accountId=${toId}&includeIncomingTransfers=true`)).toHaveLength(1);
    expect(await list(`accountId=${fromId}`)).toHaveLength(1);
    expect(await list(`accountId=${fromId}&includeIncomingTransfers=true`)).toHaveLength(1);
    expect(await list(`accountId=${toId}&includeIncomingTransfers=true&hideFuture=true`)).toHaveLength(1);
    expect(await list(`accountId=${toId}&includeIncomingTransfers=true&hideFuture=true&search=zzz`)).toHaveLength(0);
  });

  it("POST /transactions with type transfer now answers with transferToId", async () => {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    const res = await POST(
      req("transactions", "POST", {
        accountId: fromId, transferToId: toId, type: "transfer", amount: 1000, category: "Transfer", date: new Date().toISOString(),
      }),
      {}
    );
    expect((await res.json()).data.transferToId).toBe(toId);
    const expense = await POST(
      req("transactions", "POST", { accountId: fromId, type: "expense", amount: 100, category: "Food", date: new Date().toISOString() }),
      {}
    );
    expect((await expense.json()).data.transferToId).toBeNull();
  });
});

// ── subscription detector routes ───────────────────────────────────────────

describe("integration subscriptions", () => {
  const KEY = "test-subscriptions-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Sub User", email: `sub${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `subo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
  });

  function get(query = "", headers: Record<string, string> = { authorization: `Bearer ${KEY}` }) {
    return new NextRequest(`http://localhost/api/integrations/subscriptions${query}`, { headers });
  }
  function patch(id: string, body: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/subscriptions/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `sub-key-${n}`, ...headers },
      body: JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  // Four monthly charges ending five days ago.
  async function seedMonthly(user: string, description: string, amount: number, extra: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    const { subMonths, subDays } = await import("date-fns");
    const last = subDays(new Date(), 5);
    for (let i = 0; i < 4; i++) {
      await Transaction.create({
        user, account: accountId, type: "expense", amount, category: "entertainment", description,
        date: subMonths(last, i), ...extra,
      });
    }
  }

  it("GET returns detected subscriptions with costs and totals, newest data only for this user", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    await seedMonthly(userId, "Netflix", 64900);
    await seedMonthly(otherUserId, "Hotstar", 29900);

    const res = await GET(get(), {} as never);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.subscriptions).toHaveLength(1);
    const s = json.data.subscriptions[0];
    expect(s).toMatchObject({ merchant: "Netflix", cadence: "monthly", amount: 64900, monthlyCost: 64900, yearlyCost: 778800, status: "detected", active: true, occurrences: 4 });
    expect(s.key).toBeUndefined();
    expect(json.data.totals).toEqual({ count: 1, monthly: 64900, yearly: 778800 });
  });

  it("GET with no history returns an empty list, and needs the API key", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    const res = await GET(get(), {} as never);
    expect((await res.json()).data).toEqual({ subscriptions: [], totals: { count: 0, monthly: 0, yearly: 0 } });
    expect((await GET(get("", {}), {} as never)).status).toBe(401);
  });

  it("ignores recurring series the user already tracks and deleted rows", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    await seedMonthly(userId, "Rent", 2000000, { isRecurring: true });
    await seedMonthly(userId, "Gym", 50000, { isDeleted: true });
    const json = await (await GET(get(), {} as never)).json();
    expect(json.data.subscriptions).toEqual([]);
  });

  it("PATCH confirms, dismisses and restores; the list follows the status filter", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    const { PATCH } = await import("@/app/api/integrations/subscriptions/[id]/route");
    await seedMonthly(userId, "Netflix", 64900);
    const id = (await (await GET(get(), {} as never)).json()).data.subscriptions[0].id as string;

    const confirmed = await PATCH(patch(id, { status: "confirmed" }), ctx(id));
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data.status).toBe("confirmed");
    expect((await (await GET(get("?status=confirmed"), {} as never)).json()).data.subscriptions).toHaveLength(1);

    await PATCH(patch(id, { status: "dismissed" }), ctx(id));
    const hidden = (await (await GET(get(), {} as never)).json()).data;
    expect(hidden.subscriptions).toEqual([]);
    expect(hidden.totals.count).toBe(0);
    expect((await (await GET(get("?status=dismissed"), {} as never)).json()).data.subscriptions).toHaveLength(1);
    expect((await (await GET(get("?status=all"), {} as never)).json()).data.subscriptions).toHaveLength(1);

    await PATCH(patch(id, { status: "detected" }), ctx(id));
    const back = (await (await GET(get(), {} as never)).json()).data.subscriptions;
    expect(back).toHaveLength(1);
    expect(back[0].status).toBe("detected");
  });

  it("PATCH replays on the same Idempotency-Key and rejects the same key with a different body", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    const { PATCH } = await import("@/app/api/integrations/subscriptions/[id]/route");
    const { default: SubscriptionDecision } = await import("@/models/SubscriptionDecision");
    await seedMonthly(userId, "Netflix", 64900);
    const id = (await (await GET(get(), {} as never)).json()).data.subscriptions[0].id as string;

    const first = await PATCH(patch(id, { status: "confirmed" }, { "idempotency-key": "same" }), ctx(id));
    const replay = await PATCH(patch(id, { status: "confirmed" }, { "idempotency-key": "same" }), ctx(id));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await SubscriptionDecision.countDocuments({ user: userId })).toBe(1);

    const clash = await PATCH(patch(id, { status: "dismissed" }, { "idempotency-key": "same" }), ctx(id));
    expect(clash.status).toBe(409);
  });

  it("PATCH rejects a bad status, a bad id and a missing key; 404 for someone else's or an unknown subscription", async () => {
    const { GET } = await import("@/app/api/integrations/subscriptions/route");
    const { PATCH } = await import("@/app/api/integrations/subscriptions/[id]/route");
    await seedMonthly(otherUserId, "Hotstar", 29900);
    await seedMonthly(userId, "Netflix", 64900);
    const mine = (await (await GET(get(), {} as never)).json()).data.subscriptions[0].id as string;

    expect((await PATCH(patch(mine, { status: "paid" }), ctx(mine))).status).toBe(400);
    expect((await PATCH(patch("nope", { status: "confirmed" }), ctx("nope"))).status).toBe(400);
    const noKey = new NextRequest(`http://localhost/api/integrations/subscriptions/${mine}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect((await PATCH(noKey, ctx(mine))).status).toBe(400);

    const { subscriptionId } = await import("@/lib/subscription-detector");
    const unknown = subscriptionId("hotstar|monthly"); // only the other user has it
    expect((await PATCH(patch(unknown, { status: "confirmed" }), ctx(unknown))).status).toBe(404);
  });

  it("a decision for one user does not change another user's list", async () => {
    const { setSubscriptionStatus, listSubscriptions } = await import("@/lib/subscription-service");
    await seedMonthly(userId, "Netflix", 64900);
    const { default: Account } = await import("@/models/Account");
    const otherAccount = await Account.create({ user: otherUserId, name: "Bank", type: "bank", balance: 1, currency: "INR" });
    const { default: Transaction } = await import("@/models/Transaction");
    const { subMonths, subDays } = await import("date-fns");
    for (let i = 0; i < 4; i++) {
      await Transaction.create({ user: otherUserId, account: otherAccount._id, type: "expense", amount: 64900, category: "entertainment", description: "Netflix", date: subMonths(subDays(new Date(), 5), i) });
    }
    const mine = (await listSubscriptions(userId)).subscriptions[0];
    await setSubscriptionStatus(userId, mine.id, "dismissed");
    expect((await listSubscriptions(userId)).subscriptions).toHaveLength(0);
    expect((await listSubscriptions(otherUserId)).subscriptions).toHaveLength(1);
  });
});

// ── Bill due reminders ─────────────────────────────────────────────────────

describe("bills: upcoming list, mark paid, settings and reminders", () => {
  const KEY = "test-bills-api-key";
  const DAY = 86_400_000;
  // 10:00 on 24 Oct in Kolkata (04:30Z), and 08:00 the same day.
  const now = new Date("2026-10-24T04:30:00Z");
  const early = new Date("2026-10-24T02:30:00Z");
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let actor: { id: string; name: string; email: string; role: string };
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Bill User", email: `bill${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `billo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 1000000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
    actor = { id: userId, name: user.name, email: user.email, role: "user" };
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/bills${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": `bill-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const payCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function installment(label: string, due: Date, over: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    const { Types } = await import("mongoose");
    return Transaction.create({
      user: userId,
      account: accountId,
      type: "expense",
      amount: 200000,
      category: "Rent",
      date: due,
      isRecurring: true,
      recurringId: new Types.ObjectId(),
      recurrenceLabel: label,
      recurrenceFrequency: "monthly",
      installmentIndex: 1,
      installmentStatus: "upcoming",
      ...over,
    });
  }
  async function loan(due: Date | undefined, over: Record<string, unknown> = {}) {
    const { default: Loan } = await import("@/models/Loan");
    return Loan.create({
      user: userId,
      direction: "received",
      counterparty: "Asha",
      principalAmount: 500000,
      remainingAmount: 500000,
      startDate: new Date(now.getTime() - 30 * DAY),
      dueDate: due,
      ...over,
    });
  }
  async function enable(leadDays = 3, timezone = "Asia/Kolkata") {
    const { default: User } = await import("@/models/User");
    await User.updateOne(
      { _id: userId },
      { $set: { "preferences.billReminders": { enabled: true, leadDays }, "preferences.timezone": timezone } }
    );
  }
  const notices = async () => {
    const { default: Notification } = await import("@/models/Notification");
    return Notification.find({ user: userId, "meta.kind": "bill_reminder" }).sort({ createdAt: 1 }).lean<Array<{ type: string; title: string; body: string }>>();
  };

  it("daysUntil counts calendar days on the user's wall clock", async () => {
    const { daysUntil } = await import("@/lib/bills");
    const due = new Date("2026-10-24T20:00:00Z"); // 01:30 on the 25th in Kolkata, 16:00 on the 24th in New York
    expect(daysUntil(due, now, "Asia/Kolkata")).toBe(1);
    expect(daysUntil(due, now, "America/New_York")).toBe(0);
    expect(daysUntil(new Date(now.getTime() - 2 * DAY), now, "Asia/Kolkata")).toBe(-2);
    expect(daysUntil(due, now, "Not/AZone")).toBe(1); // falls back to Asia/Kolkata
  });

  it("lists recurring payments and loans owed, soonest first, with overdue marked", async () => {
    const { listUpcomingBills } = await import("@/lib/bills");
    await installment("Rent", new Date(now.getTime() + 5 * DAY));
    await installment("Gym", new Date(now.getTime() - 2 * DAY));
    await installment("Far away", new Date(now.getTime() + 40 * DAY));
    await installment("Old news", new Date(now.getTime() - 90 * DAY));
    await installment("Salary", new Date(now.getTime() + 2 * DAY), { type: "income" });
    await installment("Paid already", new Date(now.getTime() + 1 * DAY), { installmentStatus: "paid" });
    await loan(new Date(now.getTime() + 1 * DAY));
    await loan(new Date(now.getTime() + 1 * DAY), { direction: "given", counterparty: "Ravi" });
    await loan(new Date(now.getTime() + 1 * DAY), { isSettled: true, counterparty: "Settled" });
    await loan(undefined, { counterparty: "No due date" });

    const bills = await listUpcomingBills(userId, { days: 14, now });
    expect(bills.map((b) => [b.title, b.kind, b.status, b.daysUntil])).toEqual([
      ["Gym", "recurring", "overdue", -2],
      ["Loan from Asha", "loan", "upcoming", 1],
      ["Rent", "recurring", "upcoming", 5],
    ]);
    expect(bills[0]).toMatchObject({ amount: 200000, currency: "INR", canMarkPaid: true, accountId });
    expect(bills[1]).toMatchObject({ amount: 500000, canMarkPaid: true });
  });

  it("only lists this user's bills", async () => {
    const { listUpcomingBills } = await import("@/lib/bills");
    await installment("Mine", new Date(now.getTime() + DAY));
    expect(await listUpcomingBills(otherUserId, { days: 14, now })).toEqual([]);
  });

  it("lists the next unpaid statement of a credit card", async () => {
    const { listUpcomingBills } = await import("@/lib/bills");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const today = new Date();
    const closeDay = Math.min(new Date(today.getTime() - 10 * DAY).getDate(), 28);
    const card = await Account.create({
      user: userId,
      name: "Axis",
      type: "credit_card",
      balance: 0,
      currency: "INR",
      creditMeta: { billingCycleDay: closeDay, paymentDueDay: 28, creditLimit: 5000000, minPaymentPct: 5 },
    });
    await Transaction.create({ user: userId, account: card._id, type: "expense", amount: 123400, category: "shopping", date: new Date(today.getTime() - 15 * DAY) });
    const bills = await listUpcomingBills(userId, { days: 60, now: today });
    const cardBill = bills.find((b) => b.kind === "card");
    expect(cardBill).toMatchObject({ title: "Axis payment", amount: 123400, canMarkPaid: false, accountId: String(card._id) });
    expect(cardBill!.id).toMatch(new RegExp(`^card:${String(card._id)}:\\d{4}-\\d{2}-\\d{2}$`));
  });

  it("marking a recurring payment paid takes the money from its account, once", async () => {
    const { markBillPaid } = await import("@/lib/bills");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const t = await installment("Rent", new Date(now.getTime() + DAY));
    const result = await markBillPaid(userId, `recurring:${String(t._id)}`, actor);
    expect(result).toMatchObject({ kind: "recurring", paid: true, amount: 200000 });
    expect((await Transaction.findById(t._id).lean<{ installmentStatus: string }>())!.installmentStatus).toBe("paid");
    expect((await Account.findById(accountId).lean<{ balance: number }>())!.balance).toBe(800000);
    await expect(markBillPaid(userId, `recurring:${String(t._id)}`, actor)).rejects.toMatchObject({ code: "ALREADY_PAID" });
    expect((await Account.findById(accountId).lean<{ balance: number }>())!.balance).toBe(800000);
  });

  it("marking a loan paid records a repayment and settles it; a part payment leaves the rest", async () => {
    const { markBillPaid } = await import("@/lib/bills");
    const { default: Loan } = await import("@/models/Loan");
    const { default: Account } = await import("@/models/Account");
    const first = await loan(new Date(now.getTime() + DAY));
    await markBillPaid(userId, `loan:${String(first._id)}`, actor, { amount: 200000, accountId });
    expect((await Loan.findById(first._id).lean<{ remainingAmount: number; isSettled: boolean }>())).toMatchObject({ remainingAmount: 300000, isSettled: false });
    expect((await Account.findById(accountId).lean<{ balance: number }>())!.balance).toBe(800000);
    const rest = await markBillPaid(userId, `loan:${String(first._id)}`, actor, { accountId });
    expect(rest.amount).toBe(300000);
    expect((await Loan.findById(first._id).lean<{ isSettled: boolean }>())!.isSettled).toBe(true);
    await expect(markBillPaid(userId, `loan:${String(first._id)}`, actor)).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("refuses cards, bad ids and other people's bills", async () => {
    const { markBillPaid } = await import("@/lib/bills");
    const t = await installment("Rent", new Date(now.getTime() + DAY));
    const l = await loan(new Date(now.getTime() + DAY));
    const strangerActor = { ...actor, id: otherUserId };
    await expect(markBillPaid(userId, `card:${accountId}:2026-10-05`, actor)).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    await expect(markBillPaid(userId, "nonsense", actor)).rejects.toMatchObject({ code: "INVALID_BILL" });
    await expect(markBillPaid(userId, "recurring:not-an-id", actor)).rejects.toMatchObject({ code: "INVALID_BILL" });
    await expect(markBillPaid(otherUserId, `recurring:${String(t._id)}`, strangerActor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markBillPaid(otherUserId, `loan:${String(l._id)}`, strangerActor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("GET /api/integrations/bills returns bills and the settings, and needs the key", async () => {
    const { GET } = await import("@/app/api/integrations/bills/route");
    await installment("Rent", new Date(Date.now() + 2 * DAY));
    const res = await GET(req("?days=7"), {});
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.settings).toEqual({ enabled: false, leadDays: 3 });
    expect(json.data.days).toBe(7);
    expect(json.data.bills).toHaveLength(1);
    expect(json.data.bills[0]).toMatchObject({ kind: "recurring", title: "Rent", status: "upcoming" });
    expect((await GET(req("", "GET", undefined, { authorization: "Bearer wrong" }), {})).status).toBe(401);
    const clamped = await (await GET(req("?days=9999"), {})).json();
    expect(clamped.data.days).toBe(60);
  });

  it("POST /api/integrations/bills/[id]/pay marks it paid, replays on the same key and rejects a card", async () => {
    const { POST } = await import("@/app/api/integrations/bills/[id]/pay/route");
    const t = await installment("Rent", new Date(Date.now() + DAY));
    const id = `recurring:${String(t._id)}`;
    const headers = { "idempotency-key": "pay-once" };
    const first = await POST(req(`/${encodeURIComponent(id)}/pay`, "POST", undefined, headers), payCtx(encodeURIComponent(id)));
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({ id, paid: true, kind: "recurring" });
    const replay = await POST(req(`/${encodeURIComponent(id)}/pay`, "POST", undefined, headers), payCtx(encodeURIComponent(id)));
    expect(replay.status).toBe(200);
    const again = await POST(req(`/${encodeURIComponent(id)}/pay`, "POST", undefined), payCtx(encodeURIComponent(id)));
    expect(again.status).toBe(400);
    expect((await again.json()).error.reason).toBe("ALREADY_PAID");

    const card = await POST(req(`/card:${accountId}:2026-10-05/pay`, "POST"), payCtx(`card:${accountId}:2026-10-05`));
    expect(card.status).toBe(400);
    expect((await card.json()).error.reason).toBe("NOT_PAYABLE");
    const missing = await POST(req(`/recurring:${otherUserId}/pay`, "POST"), payCtx(`recurring:${otherUserId}`));
    expect(missing.status).toBe(404);
    const noKey = await POST(
      new NextRequest("http://localhost/api/integrations/bills/x/pay", { method: "POST", headers: { authorization: `Bearer ${KEY}` } }),
      payCtx("x")
    );
    expect(noKey.status).toBe(400);
    const badBody = await POST(req(`/${encodeURIComponent(id)}/pay`, "POST", { amount: -5 }), payCtx(encodeURIComponent(id)));
    expect(badBody.status).toBe(400);
  });

  it("settings default to off, validate, and change only what is sent", async () => {
    const { GET, PATCH } = await import("@/app/api/integrations/bills/settings/route");
    expect((await (await GET(req("/settings"), {})).json()).data).toEqual({ enabled: false, leadDays: 3 });
    for (const bad of [{}, { leadDays: 0 }, { leadDays: 15 }, { leadDays: 2.5 }, { enabled: "yes" }, { other: 1 }]) {
      expect((await PATCH(req("/settings", "PATCH", bad), {})).status).toBe(400);
    }
    const noKey = await PATCH(
      new NextRequest("http://localhost/api/integrations/bills/settings", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      {}
    );
    expect(noKey.status).toBe(400);
    expect((await (await PATCH(req("/settings", "PATCH", { enabled: true }), {})).json()).data).toEqual({ enabled: true, leadDays: 3 });
    expect((await (await PATCH(req("/settings", "PATCH", { leadDays: 7 }), {})).json()).data).toEqual({ enabled: true, leadDays: 7 });
    expect((await (await GET(req("/settings"), {})).json()).data).toEqual({ enabled: true, leadDays: 7 });
  });

  it("reminds once when a bill enters the lead time, waits for 09:00 and never repeats", async () => {
    const { sendBillReminders } = await import("@/lib/bill-reminders");
    await enable(3);
    await installment("Rent", new Date(now.getTime() + 2 * DAY));
    await installment("Later", new Date(now.getTime() + 10 * DAY));
    await loan(new Date(now.getTime() + 1 * DAY));

    expect(await sendBillReminders(early)).toEqual({ checked: 1, sent: 0 }); // 08:00 in Kolkata
    expect(await notices()).toHaveLength(0);

    expect(await sendBillReminders(now)).toEqual({ checked: 1, sent: 2 });
    expect(await sendBillReminders(new Date(now.getTime() + 30 * 60_000))).toEqual({ checked: 1, sent: 0 });
    const sent = await notices();
    expect(sent.map((s) => [s.type, s.title])).toEqual(
      expect.arrayContaining([
        ["emi_due", "Rent is due in 2 days"],
        ["loan_due", "Loan from Asha is due tomorrow"],
      ])
    );
    expect(sent.find((s) => s.type === "emi_due")!.body).toBe("Rent (₹2,000.00) is due in 2 days.");

    // Eight days on, the far bill is inside the lead time and the first two went overdue:
    // each gets its own reminder, and nothing is sent twice.
    const later = new Date(now.getTime() + 8 * DAY);
    expect((await sendBillReminders(later)).sent).toBe(3);
    expect((await notices()).map((s) => s.title)).toEqual(
      expect.arrayContaining(["Later is due in 2 days", "Overdue: Rent", "Overdue: Loan from Asha"])
    );
    expect((await sendBillReminders(later)).sent).toBe(0);
  });

  it("sends one overdue reminder, separate from the due-soon one", async () => {
    const { sendBillReminders } = await import("@/lib/bill-reminders");
    await enable(3);
    await installment("Gym", new Date(now.getTime() + 1 * DAY));
    expect((await sendBillReminders(now)).sent).toBe(1);
    const dayAfter = new Date(now.getTime() + 3 * DAY);
    expect((await sendBillReminders(dayAfter)).sent).toBe(1);
    expect((await sendBillReminders(new Date(dayAfter.getTime() + 60 * 60_000))).sent).toBe(0);
    const sent = await notices();
    expect(sent.map((s) => s.title)).toEqual(["Gym is due tomorrow", "Overdue: Gym"]);
    expect(sent[1].body).toBe("Gym (₹2,000.00) was due 2 days ago.");
  });

  it("uses each user's own time zone for 09:00", async () => {
    const { sendBillReminders } = await import("@/lib/bill-reminders");
    await enable(3, "America/New_York");
    await installment("Rent", new Date(now.getTime() + 2 * DAY));
    // 10:00 in Kolkata is 00:30 in New York: not yet.
    expect((await sendBillReminders(now)).sent).toBe(0);
    // 14:00Z is 10:00 in New York.
    expect((await sendBillReminders(new Date("2026-10-24T14:00:00Z"))).sent).toBe(1);
  });

  it("skips users who have not turned reminders on, and the older due pushes stand down for those who have", async () => {
    const { sendBillReminders } = await import("@/lib/bill-reminders");
    const { checkEmiDueNotifications } = await import("@/lib/emi-notifications");
    const { default: Notification } = await import("@/models/Notification");
    const dueToday = new Date();
    dueToday.setHours(12, 0, 0, 0);
    await installment("Rent", dueToday);

    expect(await sendBillReminders(now)).toEqual({ checked: 0, sent: 0 });
    await checkEmiDueNotifications(userId);
    expect(await Notification.countDocuments({ user: userId, type: "emi_due" })).toBe(1); // the old push still works

    await Notification.deleteMany({ user: userId });
    await enable(3);
    await checkEmiDueNotifications(userId);
    expect(await Notification.countDocuments({ user: userId, type: "emi_due" })).toBe(0);
  });

  it("the cron route needs the secret and reports what it did", async () => {
    process.env.CRON_SECRET = "cron-secret-for-tests";
    const { GET } = await import("@/app/api/cron/bill-reminders/route");
    const call = (headers: Record<string, string> = {}) =>
      GET(new NextRequest("http://localhost/api/cron/bill-reminders", { headers }));
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await call({ authorization: "Bearer cron-secret-for-tests" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, checked: 0, sent: 0 });
  });
});

describe("refund and reversal matching", () => {
  const KEY = "test-refunds-api-key";
  const DAY = 24 * 60 * 60 * 1000;
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let n = 0;
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Refund User", email: `rf${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `rfo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
  });

  function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": `refund-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function txn(over: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({
      user: userId,
      account: accountId,
      type: "expense",
      amount: 25000,
      category: "shopping",
      description: "Amazon",
      date: daysAgo(10),
      ...over,
    });
  }
  const credit = (over: Record<string, unknown> = {}) =>
    txn({ type: "income", description: "Amazon", category: "other", date: daysAgo(1), ...over });

  async function reload(id: unknown) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.findById(id).lean<{
      refundOf?: { toString(): string };
      refundStatus?: string | null;
      category: string;
      refundPriorCategory?: string;
    }>();
  }

  describe("merchant matching", () => {
    it("ignores case, punctuation and company words, and needs a real name", async () => {
      const { merchantsMatch, normalizeMerchant } = await import("@/lib/refund-service");
      expect(normalizeMerchant("AMAZON PAY INDIA PVT LTD")).toBe("amazon");
      expect(merchantsMatch("Amazon", "AMAZON REFUND")).toBe(true);
      expect(merchantsMatch("Swiggy", "swiggy instamart")).toBe(true);
      expect(merchantsMatch("Amazon", "Flipkart")).toBe(false);
      expect(merchantsMatch("Captured payment", "Captured payment")).toBe(false);
      expect(merchantsMatch("", "Amazon")).toBe(false);
      expect(merchantsMatch("Mi", "Mi Store")).toBe(false);
    });
  });

  describe("suggestRefund", () => {
    it("links a credit to the expense with the same merchant and amount", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      const original = await txn();
      const refund = await credit();
      const best = await suggestRefund(userId, refund._id.toString());
      expect(best?._id.toString()).toBe(original._id.toString());
      const saved = await reload(refund._id);
      expect(saved?.refundStatus).toBe("suggested");
      expect(saved?.refundOf?.toString()).toBe(original._id.toString());
    });

    it("accepts a partial refund (a smaller amount)", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      const original = await txn({ amount: 25000 });
      const refund = await credit({ amount: 9000 });
      expect((await suggestRefund(userId, refund._id.toString()))?._id.toString()).toBe(original._id.toString());
    });

    it("does not suggest for a bigger amount, an old expense, another merchant or a plain income", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      await txn({ amount: 25000 });
      expect(await suggestRefund(userId, (await credit({ amount: 30000 }))._id.toString())).toBeNull();
      expect(await suggestRefund(userId, (await credit({ description: "Flipkart" }))._id.toString())).toBeNull();
      const old = await txn({ description: "Myntra", date: daysAgo(120) });
      expect(old).toBeTruthy();
      expect(await suggestRefund(userId, (await credit({ description: "Myntra" }))._id.toString())).toBeNull();
      expect(await suggestRefund(userId, (await credit({ description: "Salary Acme" }))._id.toString())).toBeNull();
    });

    it("does not suggest an expense dated after the credit, a voided one or a deleted one", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      await txn({ description: "Zomato", date: daysAgo(-5) });
      await txn({ description: "Zomato", reviewStatus: "voided" });
      await txn({ description: "Zomato", isDeleted: true });
      expect(await suggestRefund(userId, (await credit({ description: "Zomato" }))._id.toString())).toBeNull();
    });

    it("prefers the exact amount, then the closest in time", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      await txn({ amount: 40000, date: daysAgo(2) });
      const exact = await txn({ amount: 25000, date: daysAgo(20) });
      const refund = await credit({ amount: 25000 });
      expect((await suggestRefund(userId, refund._id.toString()))?._id.toString()).toBe(exact._id.toString());
    });

    it("never takes an expense that is already refunded up to its amount", async () => {
      const { suggestRefund, confirmRefund } = await import("@/lib/refund-service");
      const original = await txn({ amount: 25000 });
      const first = await credit({ amount: 25000 });
      await suggestRefund(userId, first._id.toString());
      await confirmRefund(userId, first._id.toString());
      const second = await credit({ amount: 5000 });
      expect(await suggestRefund(userId, second._id.toString())).toBeNull();
      expect(original).toBeTruthy();
    });

    it("lets two partial refunds share one expense until it is used up", async () => {
      const { suggestRefund, confirmRefund } = await import("@/lib/refund-service");
      await txn({ amount: 25000 });
      const a = await credit({ amount: 10000 });
      await suggestRefund(userId, a._id.toString());
      await confirmRefund(userId, a._id.toString());
      const b = await credit({ amount: 15000 });
      expect(await suggestRefund(userId, b._id.toString())).not.toBeNull();
      const c = await credit({ amount: 16000 });
      expect(await suggestRefund(userId, c._id.toString())).toBeNull();
    });

    it("does not suggest again after a rejection, nor for a credit that already has a status", async () => {
      const { suggestRefund, rejectRefund } = await import("@/lib/refund-service");
      await txn();
      const refund = await credit();
      await suggestRefund(userId, refund._id.toString());
      await rejectRefund(userId, refund._id.toString());
      expect(await suggestRefund(userId, refund._id.toString())).toBeNull();
      expect((await reload(refund._id))?.refundStatus).toBe("rejected");
    });

    it("never looks at another user's expenses", async () => {
      const { suggestRefund } = await import("@/lib/refund-service");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      const theirAccount = await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 0, currency: "INR" });
      await Transaction.create({
        user: otherUserId, account: theirAccount._id, type: "expense", amount: 25000, category: "shopping", description: "Amazon", date: daysAgo(10),
      });
      expect(await suggestRefund(userId, (await credit())._id.toString())).toBeNull();
    });
  });

  describe("capture ingest", () => {
    it("suggests the match when a credit message creates a transaction", async () => {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      await Account.updateOne({ _id: accountId }, { $set: { smsLastFour: ["1234"] } });
      const actor = { id: userId, name: "Refund User", email: "x@x.com", role: "user" };
      const at = new Date();
      const debit = await ingestCapture({
        user: actor, channel: "sms", sender: "VM-HDFCBK", receivedAt: at,
        text: "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678. Not you? Call 18002586161",
      });
      expect(debit.body.status).toBe("created");
      const original = await Transaction.findOne({ type: "expense" }).lean<{ _id: { toString(): string }; description: string }>();
      expect(original?.description).toBeTruthy();
      // The SMS dates carry over to the transactions: put the purchase two days before the refund.
      await Transaction.updateOne({ _id: original!._id }, { $set: { description: "Swiggy", date: new Date("2026-09-24T06:30:00Z") } });
      const back = await ingestCapture({
        user: actor, channel: "sms", sender: "VM-HDFCBK", receivedAt: new Date(at.getTime() + 60_000),
        text: "Rs.250.00 credited to A/c XX1234 on 26-09-26 by Swiggy refund. UPI Ref 426999999999.",
      });
      expect(back.body.status).toBe("created");
      const income = await Transaction.findOne({ type: "income" }).lean<{ refundOf?: { toString(): string }; refundStatus?: string }>();
      expect(income?.refundStatus).toBe("suggested");
      expect(income?.refundOf?.toString()).toBe(original!._id.toString());
    });

    it("leaves a credit with no matching expense alone", async () => {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      await Account.updateOne({ _id: accountId }, { $set: { smsLastFour: ["1234"] } });
      const actor = { id: userId, name: "Refund User", email: "x@x.com", role: "user" };
      const res = await ingestCapture({
        user: actor, channel: "sms", sender: "VM-HDFCBK", receivedAt: new Date(),
        text: "Rs.250.00 credited to A/c XX1234 on 26-09-26 by Swiggy refund. UPI Ref 426999999999.",
      });
      expect(res.body.status).toBe("created");
      const income = await Transaction.findOne({ type: "income" }).lean<{ refundStatus?: string | null }>();
      expect(income?.refundStatus ?? null).toBeNull();
    });
  });

  describe("confirm, reject and balances", () => {
    it("confirming carries the category over and leaves every balance alone", async () => {
      const { suggestRefund, confirmRefund } = await import("@/lib/refund-service");
      const { createTransaction } = await import("@/lib/transaction-service");
      const { default: Account } = await import("@/models/Account");
      const actor = { id: userId, name: "Refund User", email: "x@x.com", role: "user" };
      const spend = await createTransaction({
        userId, actor, accountId, type: "expense", amount: 25000, currency: "INR", category: "shopping", description: "Amazon",
        date: daysAgo(5).toISOString(), tags: [], isRecurring: false,
      });
      const back = await createTransaction({
        userId, actor, accountId, type: "income", amount: 25000, currency: "INR", category: "other", description: "Amazon refund",
        date: new Date().toISOString(), tags: [], isRecurring: false,
      });
      const backId = (back.transaction as { _id: { toString(): string } })._id.toString();
      const spendId = (spend.transaction as { _id: { toString(): string } })._id.toString();
      const before = (await Account.findById(accountId).lean<{ balance: number }>())!.balance;
      await suggestRefund(userId, backId);
      const refund = await confirmRefund(userId, backId);
      expect(refund.status).toBe("confirmed");
      expect(refund.category).toBe("shopping");
      expect(refund.original?.id).toBe(spendId);
      const saved = await reload(backId);
      expect(saved?.category).toBe("shopping");
      expect(saved?.refundPriorCategory).toBe("other");
      expect((await Account.findById(accountId).lean<{ balance: number }>())!.balance).toBe(before);
    });

    it("nets the pair out of monthly, range and daily stats and the budget", async () => {
      const { suggestRefund, confirmRefund } = await import("@/lib/refund-service");
      const { getMonthlyStats, getRangeStats, getDailyTotals } = await import("@/lib/stats-service");
      const { listBudgetsWithSpend } = await import("@/lib/budget-service");
      const { default: Budget } = await import("@/models/Budget");
      const first = new Date(now.getFullYear(), now.getMonth(), 1, 12);
      const day = (d: number) => new Date(first.getTime() + (d - 1) * DAY);
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      await Budget.create({ user: userId, category: "shopping", month, year, limitAmount: 100000, alertAt: 80 });
      await txn({ amount: 20000, category: "shopping", description: "Amazon", date: day(2) });
      await txn({ amount: 5000, category: "food", description: "Cafe", date: day(2) });
      await txn({ type: "income", amount: 70000, category: "salary", description: "Acme Salary", date: day(3) });
      const refund = await credit({ amount: 8000, date: day(4) });

      const asIncome = await getMonthlyStats(userId, year, month);
      expect(asIncome).toMatchObject({ income: 78000, expense: 25000 });

      await suggestRefund(userId, refund._id.toString());
      // Suggested is not confirmed: nothing moves yet.
      expect(await getMonthlyStats(userId, year, month)).toMatchObject({ income: 78000, expense: 25000 });
      await confirmRefund(userId, refund._id.toString());

      const monthly = await getMonthlyStats(userId, year, month);
      expect(monthly).toMatchObject({ income: 70000, expense: 17000, net: 53000 });
      expect(monthly.byCategory).toEqual([
        { category: "shopping", total: 12000 },
        { category: "food", total: 5000 },
      ]);

      const [range] = await getRangeStats(userId, [{ year, month }]);
      expect(range.stats).toMatchObject({ income: 70000, expense: 17000, net: 53000 });
      expect(range.stats.byCategory[0]).toEqual({ category: "shopping", total: 12000 });

      const days = await getDailyTotals(userId, year, month);
      expect(days[1].expense).toBe(25000);
      expect(days[3].expense).toBe(-8000);
      expect(days[3].income).toBe(0);

      const [budget] = (await listBudgetsWithSpend(userId, year, month)) as Array<{ spent: number }>;
      expect(budget.spent).toBe(12000);
    });

    it("reject unlinks a confirmed refund and restores its category", async () => {
      const { suggestRefund, confirmRefund, rejectRefund } = await import("@/lib/refund-service");
      const { getMonthlyStats } = await import("@/lib/stats-service");
      await txn({ date: daysAgo(2) });
      const refund = await credit({ date: daysAgo(1) });
      await suggestRefund(userId, refund._id.toString());
      await confirmRefund(userId, refund._id.toString());
      const d = new Date();
      const after = await rejectRefund(userId, refund._id.toString());
      expect(after.status).toBe("rejected");
      const saved = await reload(refund._id);
      expect(saved?.category).toBe("other");
      expect(saved?.refundPriorCategory).toBeUndefined();
      const stats = await getMonthlyStats(userId, d.getFullYear(), d.getMonth() + 1);
      expect(stats.income).toBeGreaterThanOrEqual(25000);
    });

    it("confirm rejects a second link, a self link, a missing credit and another user's credit", async () => {
      const { suggestRefund, confirmRefund } = await import("@/lib/refund-service");
      const original = await txn();
      const refund = await credit();
      await suggestRefund(userId, refund._id.toString());
      await confirmRefund(userId, refund._id.toString());
      await expect(confirmRefund(userId, refund._id.toString())).rejects.toMatchObject({ code: "INVALID_STATE" });
      const plain = await credit({ description: "Gift" });
      await expect(confirmRefund(userId, plain._id.toString())).rejects.toMatchObject({ code: "INVALID_STATE" });
      await expect(confirmRefund(userId, plain._id.toString(), { originalId: plain._id.toString() })).rejects.toMatchObject({ code: "INVALID_STATE" });
      await expect(confirmRefund(userId, "64f000000000000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(confirmRefund(otherUserId, plain._id.toString(), { originalId: original._id.toString() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets the user link a credit to an expense of their choice", async () => {
      const { confirmRefund } = await import("@/lib/refund-service");
      const original = await txn({ description: "Croma", category: "electronics", amount: 50000 });
      const refund = await credit({ description: "Reversal 8841", amount: 50000 });
      const result = await confirmRefund(userId, refund._id.toString(), { originalId: original._id.toString() });
      expect(result.category).toBe("electronics");
      // A bigger refund than what is left on the expense is refused.
      const tooMuch = await credit({ description: "Reversal 9", amount: 1000 });
      await expect(confirmRefund(userId, tooMuch._id.toString(), { originalId: original._id.toString() })).rejects.toMatchObject({
        code: "INVALID_STATE",
      });
    });
  });

  describe("routes", () => {
    it("GET lists suggestions with the expense they refund, for this user only", async () => {
      const { GET } = await import("@/app/api/integrations/refunds/route");
      const { suggestRefund } = await import("@/lib/refund-service");
      const original = await txn();
      const refund = await credit();
      await suggestRefund(userId, refund._id.toString());
      const res = await GET(req("refunds"), {});
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ id: refund._id.toString(), amount: 25000, status: "suggested" });
      expect(data[0].original).toMatchObject({ id: original._id.toString(), amount: 25000, category: "shopping", accountName: "Bank" });
      expect((await GET(req("refunds", "GET", undefined, { authorization: "Bearer wrong" }), {})).status).toBe(401);
    });

    it("confirm and reject need an Idempotency-Key, replay on the same key, and hide other users' credits", async () => {
      const { POST: confirm } = await import("@/app/api/integrations/refunds/[id]/confirm/route");
      const { POST: reject } = await import("@/app/api/integrations/refunds/[id]/reject/route");
      const { suggestRefund } = await import("@/lib/refund-service");
      await txn();
      const refund = await credit();
      const id = refund._id.toString();
      await suggestRefund(userId, id);

      const noKey = new NextRequest(`http://localhost/api/integrations/refunds/${id}/confirm`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: "{}",
      });
      expect((await confirm(noKey, ctx(id))).status).toBe(400);
      expect((await confirm(req(`refunds/${id}/confirm`, "POST", { originalId: "nope" }), ctx(id))).status).toBe(400);

      const first = await confirm(req(`refunds/${id}/confirm`, "POST", undefined, { "idempotency-key": "same" }), ctx(id));
      expect(first.status).toBe(200);
      const firstJson = await first.json();
      expect(firstJson.data.refund).toMatchObject({ status: "confirmed", category: "shopping" });
      const replay = await confirm(req(`refunds/${id}/confirm`, "POST", undefined, { "idempotency-key": "same" }), ctx(id));
      expect(replay.status).toBe(200);
      expect((await replay.json()).data.refund.status).toBe("confirmed");
      // A new key on an already linked credit is a conflict.
      expect((await confirm(req(`refunds/${id}/confirm`, "POST"), ctx(id))).status).toBe(409);

      const undone = await reject(req(`refunds/${id}/reject`, "POST"), ctx(id));
      expect(undone.status).toBe(200);
      expect((await undone.json()).data.refund.status).toBe("rejected");
      expect((await reject(req(`refunds/${"64f000000000000000000000"}/reject`, "POST"), ctx("64f000000000000000000000"))).status).toBe(404);
    });

    it("another user's API key cannot confirm or reject your credit", async () => {
      const { POST: confirm } = await import("@/app/api/integrations/refunds/[id]/confirm/route");
      const { default: User } = await import("@/models/User");
      const { default: ApiKey } = await import("@/models/ApiKey");
      const { hashKey } = await import("@/lib/integrations/auth");
      const THEIR_KEY = "test-refunds-other-api-key";
      await ApiKey.create({ user: otherUserId, label: "phone", keyHash: hashKey(THEIR_KEY), lastFour: THEIR_KEY.slice(-4) });
      expect(await User.countDocuments({ _id: otherUserId })).toBe(1);
      await txn();
      const refund = await credit();
      const id = refund._id.toString();
      const { suggestRefund } = await import("@/lib/refund-service");
      await suggestRefund(userId, id);
      const res = await confirm(req(`refunds/${id}/confirm`, "POST", undefined, { authorization: `Bearer ${THEIR_KEY}` }), ctx(id));
      expect(res.status).toBe(404);
      expect((await reload(id))?.refundStatus).toBe("suggested");
    });

    it("the reconcile inbox shows the suggestion on an unreviewed credit", async () => {
      const { getReviewInbox } = await import("@/lib/reconcile/inbox");
      const { suggestRefund } = await import("@/lib/refund-service");
      const original = await txn();
      const refund = await credit({ reviewStatus: "unreviewed", source: "sms" });
      await suggestRefund(userId, refund._id.toString());
      const inbox = await getReviewInbox(userId);
      const item = inbox.needsReview.find((i: { id: string }) => i.id === refund._id.toString()) as
        | { refundSuggestion: { id: string; amount: number } | null }
        | undefined;
      expect(item?.refundSuggestion).toMatchObject({ id: original._id.toString(), amount: 25000 });
    });
  });
});

// ── categorise rules (src/lib/rule-service.ts) ─────────────────────────────

describe("categorise rules", () => {
  const KEY = "test-rules-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let otherAccountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Rules", email: `ru${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `ruo${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = (await Account.create({ user: userId, name: "HDFC", type: "bank", balance: 100000, smsLastFour: ["1234"] }))._id.toString();
    otherAccountId = (await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 0 }))._id.toString();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": `rule-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function addRule(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/rules/route");
    return POST(req("rules", "POST", body, headers), {});
  }
  async function testCall(body: unknown) {
    const { POST } = await import("@/app/api/integrations/rules/test/route");
    return (await POST(req("rules/test", "POST", body), {})).json();
  }

  it("POST creates a rule and GET lists the rules in the order they run", async () => {
    const { GET } = await import("@/app/api/integrations/rules/route");
    const created = await addRule({ field: "merchant", value: "  Swiggy ", category: "food", merchantName: "Swiggy", priority: 50 });
    const createdJson = await created.json();
    expect(created.status).toBe(201);
    expect(createdJson.data).toMatchObject({ field: "merchant", op: "contains", value: "Swiggy", category: "food", merchantName: "Swiggy", priority: 50, isActive: true, tags: [] });
    await addRule({ field: "text", value: "uber", category: "transport", priority: 10 });

    const list = await (await GET(req("rules", "GET"), {})).json();
    expect(list.data.map((r: { value: string }) => r.value)).toEqual(["uber", "Swiggy"]);
  });

  it("rejects a rule that does nothing, a short value, a missing key and someone else's account", async () => {
    expect((await addRule({ field: "merchant", value: "swiggy" })).status).toBe(400);
    expect((await addRule({ field: "merchant", value: "x", category: "food" })).status).toBe(400);
    expect((await addRule({ field: "bogus", value: "swiggy", category: "food" })).status).toBe(400);

    const { POST } = await import("@/app/api/integrations/rules/route");
    const noKey = new NextRequest("http://localhost/api/integrations/rules", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ field: "merchant", value: "swiggy", category: "food" }),
    });
    expect((await POST(noKey, {})).status).toBe(400);

    const theirs = await addRule({ field: "merchant", value: "swiggy", accountId: otherAccountId });
    expect(theirs.status).toBe(404);
    const junk = await addRule({ field: "merchant", value: "swiggy", accountId: "not-an-id" });
    expect(junk.status).toBe(400);
  });

  it("replays the same Idempotency-Key and refuses it with a different body", async () => {
    const { default: Rule } = await import("@/models/Rule");
    const body = { field: "merchant", value: "zomato", category: "food" };
    const first = await addRule(body, { "idempotency-key": "same-rule" });
    const replay = await addRule(body, { "idempotency-key": "same-rule" });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect((await replay.json()).data.id).toBe((await first.json()).data.id);
    expect(await Rule.countDocuments({ user: userId })).toBe(1);

    const different = await addRule({ ...body, category: "shopping" }, { "idempotency-key": "same-rule" });
    expect(different.status).toBe(409);
  });

  it("refuses a second rule with the same match, ignoring case and spaces", async () => {
    expect((await addRule({ field: "merchant", value: "Swiggy", category: "food" })).status).toBe(201);
    const dup = await addRule({ field: "merchant", value: " swiggy ", category: "shopping" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("CONFLICT");
    // Another field or operator is a different rule.
    expect((await addRule({ field: "merchant", op: "equals", value: "swiggy", category: "food" })).status).toBe(201);
    expect((await addRule({ field: "text", value: "swiggy", category: "food" })).status).toBe(201);
  });

  it("only lists and edits your own rules", async () => {
    const { default: Rule } = await import("@/models/Rule");
    const { GET } = await import("@/app/api/integrations/rules/route");
    const { PATCH, DELETE } = await import("@/app/api/integrations/rules/[id]/route");
    const theirs = await Rule.create({ user: otherUserId, field: "merchant", value: "swiggy", valueKey: "swiggy", category: "food" });
    const id = theirs._id.toString();

    expect((await (await GET(req("rules", "GET"), {})).json()).data).toEqual([]);
    expect((await PATCH(req(`rules/${id}`, "PATCH", { priority: 1 }), ctx(id))).status).toBe(404);
    expect((await DELETE(req(`rules/${id}`, "DELETE"), ctx(id))).status).toBe(404);
    expect(await Rule.countDocuments({ _id: id })).toBe(1);
  });

  it("PATCH edits a rule, clears an action with null, and will not leave a rule empty", async () => {
    const { PATCH } = await import("@/app/api/integrations/rules/[id]/route");
    const created = await (await addRule({ field: "merchant", value: "swiggy", category: "food", merchantName: "Swiggy" })).json();
    const id = created.data.id as string;

    const edited = await PATCH(req(`rules/${id}`, "PATCH", { priority: 5, isActive: false, category: null }), ctx(id));
    const editedJson = await edited.json();
    expect(edited.status).toBe(200);
    expect(editedJson.data).toMatchObject({ priority: 5, isActive: false, category: null, merchantName: "Swiggy" });

    const empty = await PATCH(req(`rules/${id}`, "PATCH", { merchantName: null }), ctx(id));
    expect(empty.status).toBe(400);
    expect((await PATCH(req(`rules/${id}`, "PATCH", {}), ctx(id))).status).toBe(400);
    expect((await PATCH(req("rules/nope", "PATCH", { priority: 1 }), ctx("nope"))).status).toBe(400);

    const clash = await (await addRule({ field: "merchant", value: "zomato", category: "food" })).json();
    const toClash = await PATCH(req(`rules/${clash.data.id}`, "PATCH", { value: "SWIGGY" }), ctx(clash.data.id));
    expect(toClash.status).toBe(409);
  });

  it("PATCH can point a rule at one of your accounts but not someone else's", async () => {
    const { PATCH } = await import("@/app/api/integrations/rules/[id]/route");
    const created = await (await addRule({ field: "merchant", value: "swiggy", category: "food" })).json();
    const id = created.data.id as string;
    const ok = await PATCH(req(`rules/${id}`, "PATCH", { accountId }), ctx(id));
    expect((await ok.json()).data.accountId).toBe(accountId);
    expect((await PATCH(req(`rules/${id}`, "PATCH", { accountId: otherAccountId }), ctx(id))).status).toBe(404);
  });

  it("DELETE removes the rule and replays on the same key", async () => {
    const { DELETE } = await import("@/app/api/integrations/rules/[id]/route");
    const { default: Rule } = await import("@/models/Rule");
    const created = await (await addRule({ field: "merchant", value: "swiggy", category: "food" })).json();
    const id = created.data.id as string;
    const first = await DELETE(req(`rules/${id}`, "DELETE", undefined, { "idempotency-key": "del" }), ctx(id));
    expect(first.status).toBe(200);
    expect((await first.json()).data).toEqual({ id, deleted: true });
    expect(await Rule.countDocuments({ user: userId })).toBe(0);
    const replay = await DELETE(req(`rules/${id}`, "DELETE", undefined, { "idempotency-key": "del" }), ctx(id));
    expect(replay.status).toBe(200);
    const again = await DELETE(req(`rules/${id}`, "DELETE"), ctx(id));
    expect(again.status).toBe(404);
  });

  it("caps rules per user", async () => {
    const { default: Rule } = await import("@/models/Rule");
    const { MAX_RULES_PER_USER } = await import("@/lib/rule-service");
    await Rule.insertMany(
      Array.from({ length: MAX_RULES_PER_USER }, (_, i) => ({ user: userId, field: "merchant", value: `shop${i}`, valueKey: `shop${i}`, category: "other" }))
    );
    const res = await addRule({ field: "merchant", value: "one too many", category: "food" });
    expect(res.status).toBe(409);
  });

  it("rules/test matches by merchant, equals, UPI id and text, and says when nothing matches", async () => {
    await addRule({ field: "merchant", value: "swiggy", category: "food", merchantName: "Swiggy" });
    await addRule({ field: "merchant", op: "equals", value: "metro", category: "transport" });
    await addRule({ field: "upi", value: "ravi@okicici", category: "rent" });
    await addRule({ field: "text", value: "electricity bill", category: "utilities" });

    expect((await testCall({ merchant: "SWIGGY INSTAMART" })).data.rule).toMatchObject({ category: "food", merchantName: "Swiggy" });
    expect((await testCall({ merchant: "Metro" })).data.rule.category).toBe("transport");
    expect((await testCall({ merchant: "Metro Cash and Carry" })).data.matched).toBe(false);
    expect((await testCall({ text: "Rs 900 paid to Ravi via UPI ravi@okicici ref 1" })).data.rule.category).toBe("rent");
    expect((await testCall({ upi: "RAVI@okicici" })).data.rule.category).toBe("rent");
    expect((await testCall({ text: "Your Electricity Bill is due" })).data.rule.category).toBe("utilities");
    expect((await testCall({ merchant: "Unknown shop" })).data).toEqual({ matched: false });
    const { POST } = await import("@/app/api/integrations/rules/test/route");
    expect((await POST(req("rules/test", "POST", {}), {})).status).toBe(400);
  });

  it("the lowest priority number wins, then the oldest rule; inactive rules are skipped", async () => {
    await addRule({ field: "merchant", value: "amazon", category: "shopping", priority: 100 });
    await addRule({ field: "text", value: "prime", category: "subscription", priority: 100 });
    // Same priority: the older rule wins.
    expect((await testCall({ merchant: "Amazon Prime", text: "amazon prime" })).data.rule.category).toBe("shopping");

    await addRule({ field: "merchant", op: "equals", value: "amazon prime", category: "entertainment", priority: 1 });
    expect((await testCall({ merchant: "Amazon Prime" })).data.rule.category).toBe("entertainment");

    const { listRules, updateRule } = await import("@/lib/rule-service");
    const rules = await listRules(userId);
    await updateRule({ userId, ruleId: rules[0].id, isActive: false });
    expect((await testCall({ merchant: "Amazon Prime" })).data.rule.category).toBe("shopping");
  });

  describe("on a new transaction", () => {
    async function addTxn(over: Record<string, unknown>) {
      const { createTransaction } = await import("@/lib/transaction-service");
      const { default: Transaction } = await import("@/models/Transaction");
      const actor = { id: userId, name: "Rules", email: "r@x.com", role: "user" };
      const result = await createTransaction({
        userId,
        actor,
        accountId,
        type: "expense",
        amount: 25000,
        currency: "INR",
        tags: [],
        isRecurring: false,
        date: new Date().toISOString(),
        ...over,
      } as Parameters<typeof createTransaction>[0]);
      return Transaction.findById((result.transaction as { _id: unknown })._id).lean<{ category: string; description?: string; tags: string[] }>();
    }

    it("fills a category left at 'other', a missing merchant name and the tags", async () => {
      await addRule({ field: "text", value: "swiggy", category: "food", merchantName: "Swiggy", tags: ["delivery"] });
      const t = await addTxn({ category: "other", note: "dinner on swiggy" });
      expect(t).toMatchObject({ category: "food", description: "Swiggy", tags: ["delivery"] });
    });

    it("never overwrites a category or a merchant name the person chose", async () => {
      await addRule({ field: "merchant", value: "swiggy", category: "food", merchantName: "Swiggy", tags: ["delivery"] });
      const t = await addTxn({ category: "Gifts", description: "swiggy gift card", tags: ["mine"] });
      expect(t).toMatchObject({ category: "Gifts", description: "swiggy gift card" });
      expect(t!.tags).toEqual(["mine", "delivery"]);
    });

    it("leaves transfers and rule-less users exactly as given", async () => {
      const t = await addTxn({ category: "other", description: "swiggy" });
      expect(t).toMatchObject({ category: "other", description: "swiggy", tags: [] });

      await addRule({ field: "merchant", value: "swiggy", category: "food" });
      const { default: Account } = await import("@/models/Account");
      const dest = await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0 });
      const tr = await addTxn({ type: "transfer", transferToId: dest._id.toString(), category: "other", description: "swiggy" });
      expect(tr!.category).toBe("other");
    });

    it("does not change a captured payment's behaviour when there are no rules", async () => {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const { default: Transaction } = await import("@/models/Transaction");
      const actor = { id: userId, name: "Rules", email: "r@x.com", role: "user" };
      const res = await ingestCapture({
        user: actor,
        channel: "sms",
        text: "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678.",
        receivedAt: new Date("2026-09-26T06:30:00Z"),
        sender: "VM-HDFCBK",
      });
      expect(res.body.status).toBe("created");
      const t = await Transaction.findOne({ user: userId }).lean<{ category: string; description?: string }>();
      expect(t!.category).toBe("other");
      expect(t!.description).toBeTruthy();
    });

    it("sets category and a clean merchant name on a captured payment, matching a UPI id", async () => {
      await addRule({ field: "upi", value: "swiggy@icici", category: "food", merchantName: "Swiggy" });
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const { default: Transaction } = await import("@/models/Transaction");
      const actor = { id: userId, name: "Rules", email: "r@x.com", role: "user" };
      const res = await ingestCapture({
        user: actor,
        channel: "sms",
        text: "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678.",
        receivedAt: new Date("2026-09-26T06:30:00Z"),
        sender: "VM-HDFCBK",
      });
      expect(res.body.status).toBe("created");
      const t = await Transaction.findOne({ user: userId }).lean<{ category: string; description?: string; reviewStatus: string }>();
      expect(t).toMatchObject({ category: "food", description: "Swiggy", reviewStatus: "unreviewed" });
    });

    it("places a capture that matched no account on the account a rule names", async () => {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      const { default: Transaction } = await import("@/models/Transaction");
      const actor = { id: userId, name: "Rules", email: "r@x.com", role: "user" };
      const text = "Rs.250.00 debited from A/c XX9999 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678.";
      const before = await ingestCapture({ user: actor, channel: "sms", text, receivedAt: new Date("2026-09-26T06:30:00Z"), sender: "VM-HDFCBK" });
      expect(before.body.status).toBe("queued");

      await addRule({ field: "upi", value: "swiggy@icici", category: "food", accountId });
      const after = await ingestCapture({ user: actor, channel: "sms", text: text.replace("426912345678", "426912345999"), receivedAt: new Date("2026-09-27T06:30:00Z"), sender: "VM-HDFCBK" });
      expect(after.body.status).toBe("created");
      const t = await Transaction.findOne({ user: userId, "captures.0": { $exists: true } }).sort({ createdAt: -1 }).lean<{ account: { toString(): string }; category: string }>();
      expect(t!.account.toString()).toBe(accountId);
      expect(t!.category).toBe("food");
    });
  });

  describe("browser routes", () => {
    afterEach(() => {
      sessionUser.current = null;
    });

    function browserReq(method: string, body?: unknown, path = "rules") {
      return new NextRequest(`http://localhost/api/${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    it("needs a session and shares the service with the integration routes", async () => {
      const { GET, POST } = await import("@/app/api/rules/route");
      expect((await GET()).status).toBe(401);

      sessionUser.current = { id: userId, name: "Rules", email: "r@x.com", role: "user" };
      const made = await POST(browserReq("POST", { field: "merchant", value: "swiggy", category: "food" }));
      expect(made.status).toBe(201);
      const id = (await made.json()).data.id as string;
      expect((await POST(browserReq("POST", { field: "merchant", value: "SWIGGY", category: "food" }))).status).toBe(409);
      expect((await POST(browserReq("POST", { field: "merchant", value: "swiggy" }))).status).toBe(400);

      const listed = await (await GET()).json();
      expect(listed.data).toHaveLength(1);

      const { PATCH, DELETE } = await import("@/app/api/rules/[id]/route");
      const patched = await PATCH(browserReq("PATCH", { priority: 3 }, `rules/${id}`), ctx(id));
      expect((await patched.json()).data.priority).toBe(3);
      expect((await DELETE(browserReq("DELETE", undefined, `rules/${id}`), ctx(id))).status).toBe(200);
      expect((await DELETE(browserReq("DELETE", undefined, `rules/${id}`), ctx(id))).status).toBe(404);
    });
  });
});

// ── cash account and ATM withdrawals ───────────────────────────────────────

describe("ATM withdrawal detection", () => {
  const RECEIVED = new Date("2026-09-26T06:30:00Z");
  const parse = async (text: string) => {
    const { parseCapture } = await import("@/lib/capture/parsers");
    return parseCapture(text, RECEIVED);
  };

  const ATM_TEXTS = [
    "Rs.5,000.00 withdrawn from A/c XX1234 at ATM ABC NAGAR on 26-09-26. Avl Bal Rs 45,000.00",
    "Cash withdrawal of Rs 2000.00 from A/c XX1234 on 26-09-26. Avl Bal INR 10,000.00",
    "INR 10,000.00 debited from A/c XX1234 on 26-Sep-26 for ATM WDL. Avl Bal INR 5,000.00",
    "Dear Customer, Rs.1,500.00 withdrawn from your A/c XX1234 using NFS cash withdrawal on 26/09/26",
    "Rs 3000 debited A/c XX1234 on 26Sep26 ATM-CASH WDL at SBI ATM. -SBI",
  ];
  for (const text of ATM_TEXTS) {
    it(`flags: ${text.slice(0, 50)}…`, async () => {
      const p = await parse(text);
      expect(p.kind).toBe("money");
      if (p.kind !== "money") return;
      expect(p.type).toBe("expense");
      expect(p.atm).toBe(true);
    });
  }

  const NOT_ATM = [
    "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678",
    "Dear Customer, Rs.499.00 spent on ICICI Bank Card XX9012 on 26-Sep-26 at ATM FOODS. Avl Lmt: Rs 1,20,000.00",
    "Rs.800.00 debited from A/c XX1234 on 26-09-26 to VPA atmcafe@icici. UPI Ref 426912345678",
    "Rs.5,000.00 deposited in A/c XX1234 via ATM on 26-09-26. Avl Bal Rs 50,000.00",
  ];
  for (const text of NOT_ATM) {
    it(`does not flag: ${text.slice(0, 50)}…`, async () => {
      const p = await parse(text);
      if (p.kind === "money") expect(p.atm).toBeUndefined();
    });
  }

  it("a credit is never an ATM withdrawal even when it mentions cash withdrawal", async () => {
    const p = await parse("Rs.500.00 credited to A/c XX1234 on 26-09-26 as reversal of failed cash withdrawal");
    if (p.kind === "money") expect(p.atm).toBeUndefined();
  });
});

describe("ATM captures become transfers to cash", () => {
  const T0 = new Date("2026-09-26T06:30:00Z");
  const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
  const ATM_SMS = "Rs.5,000.00 withdrawn from A/c XX1234 at ATM ABC NAGAR on 26-09-26. Avl Bal Rs 45,000.00";
  const ATM_NOTIFICATION = "₹5,000 withdrawn at ATM from A/c XX1234";

  async function setup({ withCash = true }: { withCash?: boolean } = {}) {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "Atm", email: `atm${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const bank = await Account.create({ user: user._id, name: "HDFC", type: "bank", balance: 100000, currency: "INR", smsLastFour: ["1234"] });
    const cash = withCash ? await Account.create({ user: user._id, name: "Cash", type: "cash", balance: 2000, currency: "INR" }) : null;
    const actor = { id: user._id.toString(), name: user.name, email: user.email, role: "user" };
    return { user, bank, cash, actor };
  }

  async function ingest(actor: { id: string; name: string; email: string; role: string }, channel: "sms" | "notification" | "n8n", text: string, receivedAt: Date) {
    const { ingestCapture } = await import("@/lib/capture/ingest");
    return ingestCapture({ user: actor, channel, text, receivedAt, sender: channel === "sms" ? "VM-HDFCBK" : undefined });
  }

  async function balanceOf(id: unknown) {
    const { default: Account } = await import("@/models/Account");
    return (await Account.findById(id).lean<{ balance: number }>())!.balance;
  }

  async function liveTxns(userId: unknown) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.find({ user: userId, isDeleted: { $ne: true } }).lean<
      { _id: unknown; type: string; amount: number; account: unknown; transferTo?: unknown; reviewStatus: string | null; description: string; category: string }[]
    >();
  }

  it("an ATM SMS moves money from the bank to cash, once, and is not spending", async () => {
    const { actor, bank, cash } = await setup();
    const res = await ingest(actor, "sms", ATM_SMS, T0);
    expect(res.httpStatus).toBe(201);
    expect(res.body.status).toBe("created");

    const [txn] = await liveTxns(actor.id);
    expect(txn).toMatchObject({ type: "transfer", amount: 500000, description: "ATM withdrawal", category: "Transfer", reviewStatus: "unreviewed" });
    expect(String(txn.account)).toBe(String(bank._id));
    expect(String(txn.transferTo)).toBe(String(cash!._id));
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
    expect(await balanceOf(cash!._id)).toBe(2000 + 500000);

    const { getRangeStats } = await import("@/lib/stats-service");
    const [month] = await getRangeStats(actor.id, [{ year: 2026, month: 9 }]);
    expect(month.stats.expense).toBe(0);

    const { verifyLedgerChain } = await import("@/lib/ledger");
    expect(((await verifyLedgerChain(actor.id)) as { valid: boolean }).valid).toBe(true);
  });

  it("the same message again (n8n, a day later) is a duplicate: one transfer, balances unchanged", async () => {
    const { actor, bank, cash } = await setup();
    await ingest(actor, "sms", ATM_SMS, T0);
    const again = await ingest(actor, "n8n", `VM-HDFCBK: ${ATM_SMS}`, minutes(25 * 60));
    expect(again.body.status).toBe("duplicate");
    expect(await liveTxns(actor.id)).toHaveLength(1);
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
    expect(await balanceOf(cash!._id)).toBe(2000 + 500000);
  });

  it("a notification and then its SMS give one transfer", async () => {
    const { actor, bank, cash } = await setup();
    const held = await ingest(actor, "notification", ATM_NOTIFICATION, T0);
    expect(held.body.status).toBe("pending");
    const sms = await ingest(actor, "sms", ATM_SMS, minutes(2));
    expect(sms.body.status).toBe("created");
    const txns = await liveTxns(actor.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("transfer");
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
    expect(await balanceOf(cash!._id)).toBe(2000 + 500000);
  });

  it("a transfer made from a promoted notification is left alone when the SMS arrives later", async () => {
    const { actor, bank, cash } = await setup();
    await ingest(actor, "notification", ATM_NOTIFICATION, T0);
    const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
    const { promoted } = await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
    expect(promoted).toBe(1);
    expect(await liveTxns(actor.id)).toHaveLength(1);
    // The user already confirmed it: an SMS that "differs" (expense vs transfer) must not raise a conflict.
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.updateMany({ user: actor.id }, { $set: { reviewStatus: "confirmed" } });

    const sms = await ingest(actor, "sms", ATM_SMS, minutes(20));
    expect(["updated", "duplicate"]).toContain(sms.body.status);
    const txns = await liveTxns(actor.id);
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("transfer");
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
    expect(await balanceOf(cash!._id)).toBe(2000 + 500000);

    // Not queued as a conflict either.
    const { default: CapturedMessage } = await import("@/models/CapturedMessage");
    expect(await CapturedMessage.countDocuments({ status: "pending" })).toBe(0);
  });

  it("without a cash account it stays an ordinary expense", async () => {
    const { actor, bank } = await setup({ withCash: false });
    const res = await ingest(actor, "sms", ATM_SMS, T0);
    expect(res.body.status).toBe("created");
    const [txn] = await liveTxns(actor.id);
    expect(txn.type).toBe("expense");
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
  });

  it("an archived cash account is not used", async () => {
    const { actor, cash } = await setup();
    const { default: Account } = await import("@/models/Account");
    await Account.updateOne({ _id: cash!._id }, { $set: { isArchived: true } });
    await ingest(actor, "sms", ATM_SMS, T0);
    expect((await liveTxns(actor.id))[0].type).toBe("expense");
    expect(await balanceOf(cash!._id)).toBe(2000);
  });

  it("another user's cash account is never touched", async () => {
    const mine = await setup({ withCash: false });
    const theirs = await setup();
    await ingest(mine.actor, "sms", ATM_SMS, T0);
    expect((await liveTxns(mine.actor.id))[0].type).toBe("expense");
    expect(await balanceOf(theirs.cash!._id)).toBe(2000);
  });

  it("a card spend or UPI payment next to the word ATM is not turned into a transfer", async () => {
    const { actor } = await setup();
    await ingest(actor, "sms", "Rs.800.00 debited from A/c XX1234 on 26-09-26 to VPA atmcafe@icici. UPI Ref 426912345678", T0);
    expect((await liveTxns(actor.id))[0].type).toBe("expense");
  });

  it("an ATM withdrawal stays a transfer to cash even when a rule matches it, and a refund credit still gets its suggestion", async () => {
    const { actor, bank, cash } = await setup();
    const { createRule } = await import("@/lib/rule-service");
    // Matches both the ATM message and the Swiggy messages below.
    await createRule({ userId: actor.id, field: "text", op: "contains", value: "ATM", category: "food", merchantName: "Rule cafe", tags: ["ruled"], priority: 0, isActive: true });
    await createRule({ userId: actor.id, field: "text", op: "contains", value: "swiggy", category: "food", tags: [], priority: 1, isActive: true });

    const atm = await ingest(actor, "sms", ATM_SMS, T0);
    expect(atm.body.status).toBe("created");
    const [transfer] = await liveTxns(actor.id);
    expect(transfer).toMatchObject({ type: "transfer", description: "ATM withdrawal", category: "Transfer" });
    expect(String(transfer.transferTo)).toBe(String(cash!._id));
    expect(await balanceOf(bank._id)).toBe(100000 - 500000);
    expect(await balanceOf(cash!._id)).toBe(2000 + 500000);

    // An ordinary UPI debit next to it is spending and still gets the rule's defaults.
    const spend = await ingest(actor, "sms", "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678", minutes(10));
    expect(spend.body.status).toBe("created");
    const { default: Transaction } = await import("@/models/Transaction");
    const expense = await Transaction.findOne({ user: actor.id, type: "expense" }).lean<{ _id: unknown; category: string }>();
    expect(expense?.category).toBe("food");
    await Transaction.updateOne({ _id: expense!._id }, { $set: { description: "Swiggy", date: new Date("2026-09-24T06:30:00Z") } });

    // Its refund credit is still matched back to it, with the cash transfer ignored.
    const back = await ingest(actor, "sms", "Rs.250.00 credited to A/c XX1234 on 26-09-26 by Swiggy refund. UPI Ref 426999999999.", minutes(20));
    expect(back.body.status).toBe("created");
    const credit = await Transaction.findOne({ user: actor.id, type: "income" }).lean<{ refundStatus?: string; refundOf?: { toString(): string } }>();
    expect(credit?.refundStatus).toBe("suggested");
    expect(credit?.refundOf?.toString()).toBe(String(expense!._id));
  });
});

describe("integration cash account", () => {
  const KEY = "test-cash-api-key";
  let userId: string;
  let bankId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Cash User", email: `cs${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const bank = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 1_000_000, currency: "INR" });
    userId = user._id.toString();
    bankId = bank._id.toString();
  });

  function req(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest("http://localhost/api/integrations/cash", {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `cash-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const get = async () => {
    const { GET } = await import("@/app/api/integrations/cash/route");
    return GET(req("GET"), {});
  };
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/integrations/cash/route");
    return POST(req("POST", body, headers), {});
  };

  it("GET with no cash account answers an empty view", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      account: null,
      lowBalanceAt: 50000,
      lowBalanceIsDefault: true,
      isLow: false,
      last30Days: { withdrawn: 0, withdrawals: 0, spent: 0 },
      recentWithdrawals: [],
    });
  });

  it("POST creates the cash account (201), then updates it (200), and replays on the same key", async () => {
    const { default: Account } = await import("@/models/Account");
    const first = await post({ openingBalance: 300000, lowBalanceAt: 100000 }, { "idempotency-key": "setup" });
    expect(first.status).toBe(201);
    const { data } = await first.json();
    expect(data.account).toMatchObject({ name: "Cash", balance: 300000, currency: "INR", lowBalanceAt: 100000 });
    expect(data).toMatchObject({ lowBalanceAt: 100000, lowBalanceIsDefault: false, isLow: false });

    const replay = await post({ openingBalance: 300000, lowBalanceAt: 100000 }, { "idempotency-key": "setup" });
    expect((await replay.json()).data.account.id).toBe(data.account.id);
    expect(await Account.countDocuments({ user: userId, type: "cash" })).toBe(1);

    const second = await post({ name: "Wallet cash", lowBalanceAt: 400000, openingBalance: 999 });
    expect(second.status).toBe(200);
    const upd = (await second.json()).data;
    expect(upd.account).toMatchObject({ id: data.account.id, name: "Wallet cash", balance: 300000, lowBalanceAt: 400000 });
    expect(upd.isLow).toBe(true);
    expect(await Account.countDocuments({ user: userId, type: "cash" })).toBe(1);

    const cleared = await post({ lowBalanceAt: null });
    const c = (await cleared.json()).data;
    expect(c).toMatchObject({ lowBalanceAt: 50000, lowBalanceIsDefault: true, isLow: false });
    expect(c.account.lowBalanceAt).toBeNull();

    const reused = await post({ lowBalanceAt: 1 }, { "idempotency-key": "setup" });
    expect(reused.status).toBe(409);
  });

  it("POST with no body fields just makes sure the account exists", async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect((await res.json()).data.account).toMatchObject({ name: "Cash", balance: 0 });
    expect((await post({})).status).toBe(200);
  });

  it("POST rejects bad data, a missing key and a bad API key", async () => {
    expect((await post({ lowBalanceAt: -1 })).status).toBe(400);
    expect((await post({ lowBalanceAt: 10.5 })).status).toBe(400);
    expect((await post({ name: "" })).status).toBe(400);
    const { POST } = await import("@/app/api/integrations/cash/route");
    const noKey = new NextRequest("http://localhost/api/integrations/cash", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: "{}",
    });
    expect((await POST(noKey, {})).status).toBe(400);
    expect((await post({}, { authorization: "Bearer wrong" })).status).toBe(401);
    const { default: Account } = await import("@/models/Account");
    expect(await Account.countDocuments({ user: userId, type: "cash" })).toBe(0);
  });

  it("GET shows balance, 30 days of withdrawals and cash spending, and the latest withdrawals", async () => {
    const { createTransfer } = await import("@/lib/transfer-service");
    const { createTransaction } = await import("@/lib/transaction-service");
    const actor = { id: userId, name: "Cash User", email: "x@x.com", role: "user" };
    const created = await (await post({ openingBalance: 100000 })).json();
    const cashId = created.data.account.id as string;

    await createTransfer({ userId, actor, fromAccountId: bankId, toAccountId: cashId, amount: 200000, currency: "INR", description: "ATM withdrawal" });
    await createTransfer({ userId, actor, fromAccountId: bankId, toAccountId: cashId, amount: 50000, currency: "INR" });
    await createTransaction({
      userId, actor, accountId: cashId, type: "expense", amount: 30000, currency: "INR", category: "food",
      description: "Chai", date: new Date().toISOString(), tags: [], isRecurring: false, provenance: { source: "manual" },
    });
    // Older than 30 days: out of the totals, still the latest withdrawal list.
    await createTransfer({
      userId, actor, fromAccountId: bankId, toAccountId: cashId, amount: 70000, currency: "INR",
      date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { data } = await (await get()).json();
    expect(data.account.balance).toBe(100000 + 200000 + 50000 - 30000 + 70000);
    expect(data.last30Days).toEqual({ withdrawn: 250000, withdrawals: 2, spent: 30000 });
    expect(data.recentWithdrawals).toHaveLength(3);
    expect(data.recentWithdrawals[0]).toMatchObject({ fromAccountId: bankId });
    expect(data.isLow).toBe(false);
  });

  it("another user's cash account and withdrawals are never in the view", async () => {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const other = await User.create({ name: "Other", email: `o${Date.now()}@x.com`, password: "hash", isActive: true });
    await Account.create({ user: other._id, name: "Their cash", type: "cash", balance: 9, currency: "INR" });
    expect((await (await get()).json()).data.account).toBeNull();
  });

  it("the accounts list returns the low-cash line", async () => {
    await post({ lowBalanceAt: 123400 });
    const { GET } = await import("@/app/api/integrations/accounts/route");
    const res = await GET(new NextRequest("http://localhost/api/integrations/accounts", { headers: { authorization: `Bearer ${KEY}` } }), {});
    const list = (await res.json()).data as { type: string; lowBalanceAt?: number }[];
    expect(list.find((a) => a.type === "cash")?.lowBalanceAt).toBe(123400);
    expect(list.find((a) => a.type === "bank")?.lowBalanceAt).toBeUndefined();
  });
});

// ── cash flow forecast ────────────────────────────────────────────────────

describe("cash flow forecast", () => {
  const KEY = "test-forecast-api-key";
  const DAY = 86_400_000;
  // Real clock on purpose: subscription detection and card cycles read "now" themselves. Whole-day offsets
  // keep the local time of day, so the day an event lands on never depends on when the suite runs.
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  let userId: string;
  let otherUserId: string;
  let bankId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Forecast User", email: `fc${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `fco${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const bank = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 1_000_000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    bankId = bank._id.toString();
  });

  async function installment(label: string, due: Date, over: Record<string, unknown> = {}, forUser = userId, account = bankId) {
    const { default: Transaction } = await import("@/models/Transaction");
    const { Types } = await import("mongoose");
    return Transaction.create({
      user: forUser,
      account,
      type: "expense",
      amount: 200_000,
      category: "Rent",
      date: due,
      isRecurring: true,
      recurringId: new Types.ObjectId(),
      recurrenceLabel: label,
      recurrenceFrequency: "monthly",
      installmentIndex: 1,
      installmentStatus: "upcoming",
      ...over,
    });
  }
  async function spend(amount: number, daysAgo: number, description = "Groceries", over: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({ user: userId, account: bankId, type: "expense", amount, category: "Food", description, date: at(-daysAgo), ...over });
  }
  async function forecast(days = 30) {
    const { getCashFlowForecast } = await import("@/lib/cash-flow-forecast");
    return getCashFlowForecast(userId, { days, now });
  }

  it("starts from the money in hand: bank, cash, wallet and savings, not cards, investments or archived accounts", async () => {
    const { default: Account } = await import("@/models/Account");
    await Account.create({ user: userId, name: "Cash", type: "cash", balance: 50_000, currency: "INR" });
    await Account.create({ user: userId, name: "Wallet", type: "wallet", balance: 20_000, currency: "INR" });
    await Account.create({ user: userId, name: "Savings", type: "savings", balance: 300_000, currency: "INR" });
    await Account.create({ user: userId, name: "Fund", type: "investment", balance: 9_000_000, currency: "INR" });
    await Account.create({ user: userId, name: "Axis", type: "credit_card", balance: -400_000, currency: "INR" });
    await Account.create({ user: userId, name: "Old", type: "bank", balance: 777_000, currency: "INR", isArchived: true });
    await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 5_000_000, currency: "INR" });
    const f = await forecast(10);
    expect(f.startingBalance).toBe(1_370_000);
    expect(f.inputs.accounts).toBe(4);
    expect(f.currency).toBe("INR");
    expect(f.timeZone).toBe("Asia/Kolkata");
    expect(f.points).toHaveLength(10);
    expect(f.points[0].balance).toBe(1_370_000);
    expect(f.inputs.assumptions.length).toBeGreaterThan(2);
  });

  it("with no accounts it forecasts zero without failing", async () => {
    const { default: Account } = await import("@/models/Account");
    await Account.deleteMany({ user: userId });
    const f = await forecast(5);
    expect(f).toMatchObject({ startingBalance: 0, endBalance: 0, goesNegative: false, inputs: { accounts: 0 } });
    expect(f.points).toHaveLength(5);
  });

  it("lands unpaid recurring payments and income on their days, and leaves out paid ones and other accounts", async () => {
    const { default: Account } = await import("@/models/Account");
    const card = await Account.create({ user: userId, name: "Axis", type: "credit_card", balance: 0, currency: "INR" });
    await installment("Rent", at(3));
    await installment("Salary", at(8), { type: "income", amount: 5_000_000, category: "Salary" });
    await installment("Paid already", at(2), { installmentStatus: "paid" });
    await installment("On the card", at(2), {}, userId, String(card._id));
    await installment("Someone else's", at(2), {}, otherUserId, bankId);
    await installment("Far away", at(45));
    await installment("Gym", at(-2), { amount: 100_000 });
    const f = await forecast(30);
    const days = (offset: number) => f.points[offset].date;
    expect(f.events.map((e) => [e.label, e.kind, e.amount])).toEqual([
      ["Gym", "recurring", -100_000], // overdue: counts today
      ["Rent", "recurring", -200_000],
      ["Salary", "recurring", 5_000_000],
    ]);
    expect(f.events[0].date).toBe(days(0));
    expect(f.events[1].date).toBe(days(3));
    expect(f.events[2].date).toBe(days(8));
    expect(f.points[0].balance).toBe(900_000);
    expect(f.points[3].balance).toBe(700_000);
    expect(f.points[8].balance).toBe(5_700_000);
    expect(f.inputs.recurringCount).toBe(3);
    expect(f.totals).toMatchObject({ inflows: 5_000_000, outflows: 300_000 });
  });

  it("flags a shortfall: rent due before payday takes the balance below zero", async () => {
    const { default: Account } = await import("@/models/Account");
    await Account.updateOne({ _id: bankId }, { $set: { balance: 100_000 } });
    await installment("Rent", at(3), { amount: 300_000 });
    await installment("Salary", at(10), { type: "income", amount: 500_000 });
    const f = await forecast(14);
    expect(f.goesNegative).toBe(true);
    expect(f.firstNegativeDate).toBe(f.points[3].date);
    expect(f.lowest).toEqual({ date: f.points[3].date, balance: -200_000 });
    expect(f.points[10].balance).toBe(300_000);
    expect(f.endBalance).toBe(300_000);
  });

  it("counts loans the user owes, not money others owe", async () => {
    const { default: Loan } = await import("@/models/Loan");
    const base = { user: userId, principalAmount: 500_000, remainingAmount: 500_000, startDate: at(-30) };
    await Loan.create({ ...base, direction: "received", counterparty: "Asha", dueDate: at(4) });
    await Loan.create({ ...base, direction: "given", counterparty: "Ravi", dueDate: at(4) });
    await Loan.create({ ...base, direction: "received", counterparty: "Settled", dueDate: at(4), isSettled: true });
    const f = await forecast(30);
    expect(f.events.map((e) => [e.label, e.kind, e.amount])).toEqual([["Loan from Asha", "loan", -500_000]]);
    expect(f.inputs.billCount).toBe(1);
    expect(f.points[4].balance).toBe(500_000);
  });

  it("counts the next unpaid statement of a credit card on its due date", async () => {
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const closeDay = Math.min(new Date(now.getTime() - 10 * DAY).getDate(), 28);
    const card = await Account.create({
      user: userId,
      name: "Axis",
      type: "credit_card",
      balance: 0,
      currency: "INR",
      creditMeta: { billingCycleDay: closeDay, paymentDueDay: 28, creditLimit: 5_000_000, minPaymentPct: 5 },
    });
    await Transaction.create({ user: userId, account: card._id, type: "expense", amount: 123_400, category: "shopping", date: at(-15) });
    const f = await forecast(60);
    const cardEvent = f.events.find((e) => e.kind === "card");
    expect(cardEvent).toMatchObject({ label: "Axis payment", amount: -123_400 });
    // card purchases do not hit the balance until the statement is paid
    expect(f.points[0].balance).toBe(1_000_000);
    expect(f.inputs.dailyAverageSpend).toBe(0);
  });

  it("repeats a detected subscription on its cadence and keeps it out of the daily average", async () => {
    for (const daysAgo of [85, 55, 25]) await spend(64_900, daysAgo, "Netflix", { category: "Entertainment" });
    const f = await forecast(40);
    const subs = f.events.filter((e) => e.kind === "subscription");
    expect(subs).toHaveLength(2); // in about 5 days and again a month later
    expect(subs.every((e) => e.amount === -64_900 && e.label.toLowerCase().includes("netflix"))).toBe(true);
    expect(f.inputs.subscriptionCount).toBe(1);
    expect(f.inputs.dailyAverageSpend).toBe(0); // the one charge in the last 30 days is the subscription
  });

  it("ignores voided rows, in the daily average and in the upcoming recurring payments", async () => {
    await spend(300_000, 10);
    await spend(300_000, 12, "Groceries", { reviewStatus: "voided" }); // a duplicate that was voided
    await installment("Phantom rent", at(2), { reviewStatus: "voided", amount: 900_000 });
    const f = await forecast(5);
    expect(f.inputs.dailyAverageSpend).toBe(10_000);
    expect(f.events.map((e) => e.label)).not.toContain("Phantom rent");
  });

  async function refundOf(expense: { _id: unknown }, amount: number, account = bankId, daysAgo = 8) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({
      user: userId, account, type: "income", amount, category: "Shopping", description: "Amazon", date: at(-daysAgo),
      refundOf: expense._id, refundStatus: "confirmed",
    });
  }

  it("takes a confirmed refund off the daily average when the expense it refunds is in the count", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const amazon = await spend(600_000, 10, "Amazon");
    await refundOf(amazon, 300_000);
    await Transaction.create({ user: userId, account: bankId, type: "income", amount: 500_000, category: "Salary", description: "Pay", date: at(-7) }); // ordinary income is not a refund
    const f = await forecast(5);
    expect(f.inputs.dailyAverageSpend).toBe(10_000); // (6,000 - 3,000) / 30 days
  });

  it("a refund into this account for a card purchase, or for a purchase older than the window, does not lower the average", async () => {
    const { default: Account } = await import("@/models/Account");
    const card = await Account.create({ user: userId, name: "Card", type: "credit_card", balance: 0, currency: "INR" });
    const { default: Transaction } = await import("@/models/Transaction");
    await spend(300_000, 10, "Groceries");
    const onCard = await Transaction.create({ user: userId, account: card._id, type: "expense", amount: 900_000, category: "Shopping", description: "TV", date: at(-9) });
    await refundOf(onCard, 900_000); // the refund lands in the bank account
    const old = await spend(900_000, 45, "Sofa"); // before the 30 day window
    await refundOf(old, 900_000, bankId, 5);
    const f = await forecast(5);
    expect(f.inputs.dailyAverageSpend).toBe(10_000); // only the groceries count
  });

  it("the reported daily average is the one applied, and is never negative", async () => {
    const small = await spend(100_000, 10, "Amazon");
    await refundOf(small, 900_000); // a refund larger than the spend
    const f = await forecast(5);
    expect(f.inputs.dailyAverageSpend).toBe(0);
    expect(f.totals.dailySpendTotal).toBe(0);
    expect(f.points.map((p) => p.balance)).toEqual([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  });

  it("takes the daily average from ordinary spending of the last 30 days, from tomorrow on", async () => {
    await spend(300_000, 10);
    await spend(600_000, 40); // older than 30 days
    await installment("Rent paid", at(-5), { installmentStatus: "paid", amount: 900_000 }); // recurring rows are not everyday spend
    const f = await forecast(5);
    expect(f.inputs.dailyAverageSpend).toBe(10_000);
    expect(f.inputs.lookbackDays).toBe(30);
    expect(f.points.map((p) => p.balance)).toEqual([1_000_000, 990_000, 980_000, 970_000, 960_000]);
    expect(f.totals.dailySpendTotal).toBe(40_000);
  });

  it("uses the user's time zone for the days", async () => {
    const { default: User } = await import("@/models/User");
    const { localDateKey } = await import("@/lib/forecast-math");
    await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "America/New_York" } });
    const f = await forecast(3);
    expect(f.timeZone).toBe("America/New_York");
    expect(f.points[0].date).toBe(localDateKey(now, "America/New_York"));
  });

  describe("routes", () => {
    function req(path = "", headers: Record<string, string> = { authorization: `Bearer ${KEY}` }) {
      n += 1;
      return new NextRequest(`http://localhost/api/integrations/forecast${path}`, { method: "GET", headers: { ...headers, "x-request-id": `fc-${n}` } });
    }
    const get = async (path = "", headers?: Record<string, string>) => {
      const { GET } = await import("@/app/api/integrations/forecast/route");
      return GET(req(path, headers), {});
    };

    it("GET answers the 30 day forecast in the integration envelope", async () => {
      await installment("Rent", at(3));
      const res = await get();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({ days: 30, startingBalance: 1_000_000, goesNegative: false, currency: "INR" });
      expect(body.data.points).toHaveLength(30);
      expect(body.data.events).toHaveLength(1);
      expect(Object.keys(body.data.inputs)).toEqual(
        expect.arrayContaining(["accounts", "lookbackDays", "dailyAverageSpend", "recurringCount", "billCount", "subscriptionCount", "assumptions"])
      );
    });

    it("GET ?days sets the window from 1 to 60 and rejects anything else", async () => {
      expect((await (await get("?days=7")).json()).data.points).toHaveLength(7);
      expect((await (await get("?days=60")).json()).data.points).toHaveLength(60);
      for (const bad of ["0", "61", "-3", "abc", "1.5", ""]) {
        const res = await get(`?days=${bad}`);
        expect(res.status, `days=${bad}`).toBe(400);
        expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("GET only sees the caller's own data", async () => {
      const { default: Account } = await import("@/models/Account");
      await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 9_000_000, currency: "INR" });
      await installment("Theirs", at(2), {}, otherUserId, bankId);
      const f = (await (await get()).json()).data;
      expect(f.startingBalance).toBe(1_000_000);
      expect(f.events).toEqual([]);
    });

    it("GET needs a valid API key", async () => {
      expect((await get("", {})).status).toBe(401);
      expect((await get("", { authorization: "Bearer wrong-key" })).status).toBe(401);
    });

    it("the browser route answers the same forecast for the signed-in user, and 401 when signed out", async () => {
      const { GET } = await import("@/app/api/forecast/route");
      const call = (path = "") => GET(new NextRequest(`http://localhost/api/forecast${path}`));
      sessionUser.current = null;
      expect((await call()).status).toBe(401);
      sessionUser.current = { id: userId, name: "Forecast User", email: "fc@x.com", role: "user" };
      try {
        const res = await call("?days=5");
        expect(res.status).toBe(200);
        const { data } = await res.json();
        expect(data).toMatchObject({ days: 5, startingBalance: 1_000_000 });
        expect(data.points).toHaveLength(5);
        expect((await call("?days=99")).status).toBe(400);
      } finally {
        sessionUser.current = null;
      }
    });
  });
});

// ── sinking funds and savings rate ─────────────────────────────────────────

describe("sinking fund maths", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    _id: "f1",
    name: "Insurance",
    targetAmount: 120000,
    savedAmount: 0,
    dueDate: new Date("2026-12-15T00:00:00Z"),
    createdAt: new Date("2026-06-15T00:00:00Z"),
    ...over,
  });

  it("monthsUntil counts calendar months and stops at 0", async () => {
    const { monthsUntil } = await import("@/lib/sinking-fund-service");
    const now = new Date("2026-10-20T10:00:00Z");
    expect(monthsUntil(new Date("2026-12-05T00:00:00Z"), now)).toBe(2);
    expect(monthsUntil(new Date("2027-01-31T00:00:00Z"), now)).toBe(3);
    expect(monthsUntil(new Date("2026-10-28T00:00:00Z"), now)).toBe(0);
    expect(monthsUntil(new Date("2026-01-01T00:00:00Z"), now)).toBe(0);
  });

  it("suggests what is left spread over the months left, rounded up, and all of it when none are left", async () => {
    const { describeFund } = await import("@/lib/sinking-fund-service");
    const now = new Date("2026-10-20T10:00:00Z");
    const v = describeFund(base({ savedAmount: 20000 }), now);
    expect(v).toMatchObject({ remaining: 100000, percent: 16, monthsLeft: 2, suggestedMonthly: 50000 });
    const odd = describeFund(base({ targetAmount: 100001 }), now);
    expect(odd.suggestedMonthly).toBe(50001);
    const inDueMonth = describeFund(base({ dueDate: new Date("2026-10-28T00:00:00Z") }), now);
    expect(inDueMonth).toMatchObject({ monthsLeft: 0, suggestedMonthly: 120000 });
  });

  it("status: done, overdue, on_track against a straight line, behind", async () => {
    const { describeFund } = await import("@/lib/sinking-fund-service");
    const now = new Date("2026-09-15T00:00:00Z"); // 3 of 6 months in: half of 120000
    expect(describeFund(base({ savedAmount: 120000 }), now).status).toBe("done");
    expect(describeFund(base({ savedAmount: 130000 }), now)).toMatchObject({ status: "done", remaining: 0, percent: 100, suggestedMonthly: 0 });
    // 92 of 183 days in: the line is at 60328
    expect(describeFund(base({ savedAmount: 61000 }), now).status).toBe("on_track");
    expect(describeFund(base({ savedAmount: 60000 }), now).status).toBe("behind");
    expect(describeFund(base({ savedAmount: 10 }), new Date("2027-01-02T00:00:00Z")).status).toBe("overdue");
  });

  it("totals add up and monthlyNeeded uses the plan when there is one and skips finished funds", async () => {
    const { describeFund, totalFunds } = await import("@/lib/sinking-fund-service");
    const now = new Date("2026-10-20T10:00:00Z");
    const funds = [
      describeFund(base({ _id: "a", savedAmount: 20000 }), now), // needs 50000
      describeFund(base({ _id: "b", monthlyAmount: 7000 }), now), // plan 7000
      describeFund(base({ _id: "c", savedAmount: 120000 }), now), // done
    ];
    expect(totalFunds(funds)).toEqual({ count: 3, targetAmount: 360000, savedAmount: 140000, remaining: 220000, monthlyNeeded: 57000 });
  });
});

describe("savings rate maths", () => {
  it("rate is saved over income, null without income, and negative when overspent", async () => {
    const { savingsPoint, ratio } = await import("@/lib/savings-rate");
    expect(savingsPoint({ year: 2026, month: 10 }, 100000, 75000)).toMatchObject({ saved: 25000, rate: 0.25 });
    expect(savingsPoint({ year: 2026, month: 10 }, 0, 5000)).toMatchObject({ saved: -5000, rate: null });
    expect(savingsPoint({ year: 2026, month: 10 }, 100000, 130000).rate).toBe(-0.3);
    expect(ratio(1, 3)).toBe(0.3333);
  });

  it("lastMonths ends at the current month, oldest first, across a year boundary", async () => {
    const { lastMonths } = await import("@/lib/savings-rate");
    expect(lastMonths(3, new Date(2026, 0, 20))).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it("trend compares the latest three months with the three before, and is null with too little to compare", async () => {
    const { savingsPoint, savingsTrend } = await import("@/lib/savings-rate");
    const pts = (rates: Array<number | null>) =>
      rates.map((r, i) => savingsPoint({ year: 2026, month: i + 1 }, r === null ? 0 : 100000, r === null ? 0 : 100000 * (1 - r)));
    expect(savingsTrend(pts([0.1, 0.1, 0.1, 0.3, 0.3, 0.3]))).toBe("up");
    expect(savingsTrend(pts([0.3, 0.3, 0.3, 0.1, 0.1, 0.1]))).toBe("down");
    expect(savingsTrend(pts([0.2, 0.2, 0.2, 0.21, 0.2, 0.2]))).toBe("flat");
    expect(savingsTrend(pts([0.1, 0.3]))).toBe("up");
    expect(savingsTrend(pts([0.2]))).toBeNull();
    expect(savingsTrend(pts([null, null, 0.2]))).toBeNull();
  });
});

describe("integration sinking funds", () => {
  const KEY = "test-sinking-funds-api-key";
  let userId: string;
  let otherUserId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "SF User", email: `sf${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `sfo${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `sf-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  // A fixed time of day so the same call twice sends the same body (the idempotency fingerprint).
  const inMonths = (months: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months, 15);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  };
  const fundBody = (over: Record<string, unknown> = {}) => ({ name: "Insurance", targetAmount: 120000, dueDate: inMonths(6), ...over });

  async function create(over: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/sinking-funds/route");
    return POST(req("sinking-funds", "POST", fundBody(over), headers), {});
  }
  async function contribute(id: string, amount: number, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/sinking-funds/[id]/contribute/route");
    return POST(req(`sinking-funds/${id}/contribute`, "POST", { amount }, headers), ctx(id));
  }

  it("POST creates a fund with its computed fields, and replays on the same key", async () => {
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const first = await create({ savedAmount: 20000 }, { "idempotency-key": "mk" });
    expect(first.status).toBe(201);
    const { data } = await first.json();
    expect(data).toMatchObject({
      name: "Insurance",
      targetAmount: 120000,
      savedAmount: 20000,
      currency: "INR",
      monthlyAmount: null,
      remaining: 100000,
      percent: 16,
      isCompleted: false,
    });
    expect(data.monthsLeft).toBeGreaterThanOrEqual(5);
    expect(data.suggestedMonthly).toBe(Math.ceil(100000 / data.monthsLeft));
    expect(["on_track", "behind"]).toContain(data.status);

    const replay = await create({ savedAmount: 20000 }, { "idempotency-key": "mk" });
    expect((await replay.json()).data.id).toBe(data.id);
    expect(await SinkingFund.countDocuments({ user: userId })).toBe(1);

    const clash = await create({ name: "Other" }, { "idempotency-key": "mk" });
    expect(clash.status).toBe(409);
  });

  it("POST rejects bad bodies and a missing key", async () => {
    const { POST } = await import("@/app/api/integrations/sinking-funds/route");
    expect((await create({ name: "" })).status).toBe(400);
    expect((await create({ targetAmount: 0 })).status).toBe(400);
    expect((await create({ targetAmount: 10.5 })).status).toBe(400);
    expect((await create({ dueDate: "not a date" })).status).toBe(400);
    expect((await create({ monthlyAmount: -1 })).status).toBe(400);
    const noKey = new NextRequest("http://localhost/api/integrations/sinking-funds", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(fundBody()),
    });
    expect((await POST(noKey, {})).status).toBe(400);
  });

  it("a fund created already at its target is done", async () => {
    const res = await create({ savedAmount: 120000 });
    expect((await res.json()).data).toMatchObject({ isCompleted: true, status: "done", remaining: 0, suggestedMonthly: 0 });
  });

  it("GET lists funds soonest due first with totals, and never another user's", async () => {
    const { GET } = await import("@/app/api/integrations/sinking-funds/route");
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    await create({ name: "Later", dueDate: inMonths(9) });
    await create({ name: "Sooner", dueDate: inMonths(3), savedAmount: 30000 });
    await SinkingFund.create({ user: otherUserId, name: "Theirs", targetAmount: 999, dueDate: new Date(), savedAmount: 0 });

    const res = await GET(req("sinking-funds", "GET"), {});
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.funds.map((f: { name: string }) => f.name)).toEqual(["Sooner", "Later"]);
    expect(data.totals).toMatchObject({ count: 2, targetAmount: 240000, savedAmount: 30000, remaining: 210000 });
    expect(data.totals.monthlyNeeded).toBeGreaterThan(0);
  });

  it("GET one, PATCH, and ownership", async () => {
    const { GET, PATCH } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const { data } = await (await create()).json();
    const id = data.id as string;

    const one = await GET(req(`sinking-funds/${id}`, "GET"), ctx(id));
    expect((await one.json()).data.name).toBe("Insurance");

    const edit = await PATCH(req(`sinking-funds/${id}`, "PATCH", { name: "Car insurance", monthlyAmount: 15000, targetAmount: 150000 }), ctx(id));
    expect(edit.status).toBe(200);
    expect((await edit.json()).data).toMatchObject({ name: "Car insurance", monthlyAmount: 15000, targetAmount: 150000, remaining: 150000 });
    const cleared = await PATCH(req(`sinking-funds/${id}`, "PATCH", { monthlyAmount: null }), ctx(id));
    expect((await cleared.json()).data.monthlyAmount).toBeNull();

    expect((await PATCH(req(`sinking-funds/${id}`, "PATCH", {}), ctx(id))).status).toBe(400);
    expect((await PATCH(req(`sinking-funds/${id}`, "PATCH", { savedAmount: 5 }), ctx(id))).status).toBe(400);
    expect((await GET(req("sinking-funds/nope", "GET"), ctx("nope"))).status).toBe(400);

    const theirs = await SinkingFund.create({ user: otherUserId, name: "Theirs", targetAmount: 999, dueDate: new Date(), savedAmount: 0 });
    const tid = theirs._id.toString();
    expect((await GET(req(`sinking-funds/${tid}`, "GET"), ctx(tid))).status).toBe(404);
    expect((await PATCH(req(`sinking-funds/${tid}`, "PATCH", { name: "Mine now" }), ctx(tid))).status).toBe(404);
    expect((await contribute(tid, 100)).status).toBe(404);
    expect((await SinkingFund.findById(tid).lean<{ name: string }>())!.name).toBe("Theirs");
  });

  it("contribute adds once per key, takes money out down to 0, and rejects 0", async () => {
    const { data } = await (await create({ savedAmount: 10000 })).json();
    const id = data.id as string;

    const add = await contribute(id, 25000, { "idempotency-key": "c1" });
    expect(add.status).toBe(200);
    expect((await add.json()).data).toMatchObject({ savedAmount: 35000, remaining: 85000, percent: 29 });
    const replay = await contribute(id, 25000, { "idempotency-key": "c1" });
    expect((await replay.json()).data.savedAmount).toBe(35000);

    const take = await contribute(id, -5000);
    expect((await take.json()).data.savedAmount).toBe(30000);
    const floor = await contribute(id, -999999);
    expect((await floor.json()).data.savedAmount).toBe(0);

    expect((await contribute(id, 0)).status).toBe(400);
    expect((await contribute(id, 1.5)).status).toBe(400);
  });

  it("reaching the target completes the fund and notifies once; taking money out reopens it", async () => {
    const { default: Notification } = await import("@/models/Notification");
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const { data } = await (await create({ savedAmount: 100000 })).json();
    const id = data.id as string;

    const done = await contribute(id, 20000);
    expect((await done.json()).data).toMatchObject({ isCompleted: true, status: "done", remaining: 0 });
    expect(await Notification.countDocuments({ user: userId, "meta.sinkingFundId": id })).toBe(1);
    expect((await SinkingFund.findById(id).lean<{ completedAt?: Date }>())!.completedAt).toBeInstanceOf(Date);

    await contribute(id, 5000); // still done: no second notification
    expect(await Notification.countDocuments({ user: userId, "meta.sinkingFundId": id })).toBe(1);

    const reopened = await contribute(id, -50000);
    expect((await reopened.json()).data).toMatchObject({ isCompleted: false, completedAt: null });
    expect((await SinkingFund.findById(id).lean<{ completedAt?: Date }>())!.completedAt).toBeUndefined();
  });

  it("two contributions that both cross the target send one alert", async () => {
    const { default: Notification } = await import("@/models/Notification");
    const { data } = await (await create({ targetAmount: 100000, savedAmount: 90000 })).json();
    const id = data.id as string;
    const [a, b] = await Promise.all([contribute(id, 10000), contribute(id, 10000)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await Notification.countDocuments({ user: userId, "meta.sinkingFundId": id })).toBe(1);
  });

  it("two edits that both complete the fund send one alert", async () => {
    const { default: Notification } = await import("@/models/Notification");
    const { PATCH } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { data } = await (await create({ targetAmount: 120000, savedAmount: 100000 })).json();
    const id = data.id as string;
    const edit = () => PATCH(req(`sinking-funds/${id}`, "PATCH", { targetAmount: 100000 }), ctx(id));
    const [a, b] = await Promise.all([edit(), edit()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await Notification.countDocuments({ user: userId, "meta.sinkingFundId": id })).toBe(1);
  });

  it("refuses absurd amounts and never lets the balance pass the cap", async () => {
    expect((await create({ targetAmount: 1e15 })).status).toBe(400);
    expect((await create({ savedAmount: 1e15 })).status).toBe(400);
    expect((await create({ monthlyAmount: 1e15 })).status).toBe(400);
    const { data } = await (await create({ targetAmount: 1e14 })).json();
    const id = data.id as string;
    expect((await contribute(id, 1e15)).status).toBe(400);
    expect((await contribute(id, -1e15)).status).toBe(400);
    expect((await contribute(id, 1e14)).status).toBe(200);
    const second = await contribute(id, 1e14);
    expect(second.status).toBe(400); // refused, not quietly capped
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    expect((await SinkingFund.findById(id).lean<{ savedAmount: number }>())!.savedAmount).toBe(1e14);
    const small = await contribute(id, 1);
    expect(small.status).toBe(400); // even one paise over
    expect((await contribute(id, -1)).status).toBe(200); // taking money out still works
  });

  it("a deposit on a fund that is not yours is a 404, not a limit error", async () => {
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const theirs = await SinkingFund.create({ user: otherUserId, name: "Theirs", targetAmount: 100, savedAmount: 0, dueDate: new Date() });
    expect((await contribute(theirs._id.toString(), 50)).status).toBe(404);
  });

  it("a failed goal_reached alert does not fail or repeat the contribution", async () => {
    const { default: Notification } = await import("@/models/Notification");
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const { data } = await (await create({ targetAmount: 100000, savedAmount: 90000 })).json();
    const id = data.id as string;
    const spy = vi.spyOn(Notification, "create").mockRejectedValueOnce(new Error("notifications are down") as never);
    try {
      const first = await contribute(id, 10000, { "idempotency-key": "reach-1" });
      expect(first.status).toBe(200);
      expect((await first.json()).data).toMatchObject({ savedAmount: 100000, isCompleted: true, status: "done" });
      const replay = await contribute(id, 10000, { "idempotency-key": "reach-1" });
      expect((await replay.json()).data.savedAmount).toBe(100000);
      expect(spy).toHaveBeenCalledTimes(1); // the alert really was attempted, and its failure changed nothing
    } finally {
      spy.mockRestore();
    }
    expect((await SinkingFund.findById(id).lean<{ savedAmount: number }>())!.savedAmount).toBe(100000); // added once
  });

  it("the answer to a write does not depend on a read after it", async () => {
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const { PATCH } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { data } = await (await create({ savedAmount: 5000 })).json();
    const id = data.id as string;
    const spy = vi.spyOn(SinkingFund, "findOne").mockImplementation((() => {
      throw new Error("no read allowed after the write");
    }) as never);
    try {
      const saved = await contribute(id, 100);
      expect(saved.status).toBe(200);
      expect((await saved.json()).data).toMatchObject({ savedAmount: 5100 });
      const edited = await PATCH(req(`sinking-funds/${id}`, "PATCH", { name: "Renamed", monthlyAmount: 700 }), ctx(id));
      expect(edited.status).toBe(200);
      expect((await edited.json()).data).toMatchObject({ name: "Renamed", monthlyAmount: 700, savedAmount: 5100 });
    } finally {
      spy.mockRestore();
    }
    expect((await SinkingFund.findById(id).lean<{ name: string; savedAmount: number }>())).toMatchObject({ name: "Renamed", savedAmount: 5100 });
  });

  it("an edit and a contribution move updatedAt forward", async () => {
    const { PATCH } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { data } = await (await create({ savedAmount: 5000 })).json();
    const id = data.id as string;
    await new Promise((r) => setTimeout(r, 15));
    const edited = (await (await PATCH(req(`sinking-funds/${id}`, "PATCH", { name: "Renamed" }), ctx(id))).json()).data;
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(data.updatedAt));
    await new Promise((r) => setTimeout(r, 15));
    const saved = (await (await contribute(id, 100)).json()).data;
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(edited.updatedAt));
  });

  it("a name that starts with a dollar sign is stored as text, not read as a field", async () => {
    const { PATCH } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { data } = await (await create({ savedAmount: 5000 })).json();
    const id = data.id as string;
    const res = await PATCH(req(`sinking-funds/${id}`, "PATCH", { name: "$savedAmount" }), ctx(id));
    expect((await res.json()).data).toMatchObject({ name: "$savedAmount", savedAmount: 5000 });
  });

  it("DELETE soft-deletes, replays, and the fund leaves the list", async () => {
    const { DELETE } = await import("@/app/api/integrations/sinking-funds/[id]/route");
    const { GET } = await import("@/app/api/integrations/sinking-funds/route");
    const { default: SinkingFund } = await import("@/models/SinkingFund");
    const { data } = await (await create()).json();
    const id = data.id as string;

    const del = await DELETE(req(`sinking-funds/${id}`, "DELETE", undefined, { "idempotency-key": "d1" }), ctx(id));
    expect(del.status).toBe(200);
    expect((await del.json()).data).toEqual({ id, deleted: true });
    expect((await DELETE(req(`sinking-funds/${id}`, "DELETE", undefined, { "idempotency-key": "d1" }), ctx(id))).status).toBe(200);
    expect((await DELETE(req(`sinking-funds/${id}`, "DELETE"), ctx(id))).status).toBe(404);
    expect((await SinkingFund.findById(id).lean<{ isDeleted?: boolean }>())!.isDeleted).toBe(true);
    expect((await (await GET(req("sinking-funds", "GET"), {})).json()).data.funds).toEqual([]);
  });

  it("announces itself on realtime: its collection maps to the sinkingFunds resource", async () => {
    const { resourcesChangedSince } = await import("@/lib/realtime/changed-since");
    const before = new Date(Date.now() - 1000);
    await create();
    expect(await resourcesChangedSince(userId, before)).toContain("sinkingFunds");
    expect(await resourcesChangedSince(otherUserId, before)).not.toContain("sinkingFunds");
  });

  it("the browser routes list and create for the signed-in user", async () => {
    const { GET, POST } = await import("@/app/api/sinking-funds/route");
    sessionUser.current = { id: userId, name: "SF User", email: "sf@x.com", role: "user" };
    const made = await POST(
      new NextRequest("http://localhost/api/sinking-funds", { method: "POST", body: JSON.stringify(fundBody({ name: "Tax" })) })
    );
    expect(made.status).toBe(201);
    const list = await (await GET()).json();
    expect(list.data.funds.map((f: { name: string }) => f.name)).toEqual(["Tax"]);
    const bad = await POST(new NextRequest("http://localhost/api/sinking-funds", { method: "POST", body: JSON.stringify({}) }));
    expect(bad.status).toBe(400);
    sessionUser.current = null;
    expect((await GET()).status).toBe(401);
  });
});

describe("integration savings rate", () => {
  const KEY = "test-savings-rate-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let otherAccountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "SR User", email: `sr${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `sro${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 0, currency: "INR" });
    const wallet = await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 0, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
    otherAccountId = wallet._id.toString();
  });

  const call = async (query = "") => {
    n += 1;
    const { GET } = await import("@/app/api/integrations/savings-rate/route");
    return GET(
      new NextRequest(`http://localhost/api/integrations/savings-rate${query}`, { headers: { authorization: `Bearer ${KEY}` } }),
      {}
    );
  };
  async function add(type: "income" | "expense" | "transfer", amount: number, monthsAgo: number, extra: Record<string, unknown> = {}, user = userId) {
    const { default: Transaction } = await import("@/models/Transaction");
    const now = new Date();
    return Transaction.create({
      user,
      account: accountId,
      type,
      amount,
      currency: "INR",
      category: type === "income" ? "salary" : "food",
      date: new Date(now.getFullYear(), now.getMonth() - monthsAgo, 10, 12),
      ...extra,
    });
  }

  it("answers one entry per month, oldest first, ending with this month", async () => {
    const res = await call("?months=3");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.months).toHaveLength(3);
    const now = new Date();
    expect(data.months[2]).toMatchObject({ year: now.getFullYear(), month: now.getMonth() + 1 });
    expect(data.current).toEqual(data.months[2]);
    expect(data.months.every((m: { rate: number | null }) => m.rate === null)).toBe(true);
    expect(data.average).toEqual({ income: 0, expense: 0, saved: 0, rate: null });
    expect(data.trend).toBeNull();
  });

  it("income minus spending over income, per month, with the average over the window", async () => {
    await add("income", 100000, 0);
    await add("expense", 40000, 0);
    await add("income", 100000, 1);
    await add("expense", 80000, 1);
    await add("expense", 5000, 2); // spent with no income that month
    const { data } = await (await call("?months=3")).json();
    expect(data.months[2]).toMatchObject({ income: 100000, expense: 40000, saved: 60000, rate: 0.6 });
    expect(data.months[1]).toMatchObject({ income: 100000, expense: 80000, saved: 20000, rate: 0.2 });
    expect(data.months[0]).toMatchObject({ income: 0, expense: 5000, saved: -5000, rate: null });
    expect(data.average).toEqual({ income: 200000, expense: 125000, saved: 75000, rate: 0.375 });
    expect(data.trend).toBe("up");
  });

  it("transfers between accounts do not count, and a confirmed refund comes off spending", async () => {
    await add("income", 100000, 0);
    await add("expense", 30000, 0);
    await add("transfer", 50000, 0, { transferTo: otherAccountId });
    await add("income", 10000, 0, { refundStatus: "confirmed", category: "food" });
    const { data } = await (await call("?months=1")).json();
    expect(data.months[0]).toMatchObject({ income: 100000, expense: 20000, saved: 80000, rate: 0.8 });
  });

  it("is per user and validates months", async () => {
    await add("income", 100000, 0, {}, otherUserId);
    const { default: Account } = await import("@/models/Account");
    expect(await Account.countDocuments({ user: otherUserId })).toBe(0); // the row above has no account of theirs: ignored by user
    const { data } = await (await call("?months=1")).json();
    expect(data.months[0].income).toBe(0);
    expect((await call("?months=0")).status).toBe(400);
    expect((await call("?months=25")).status).toBe(400);
    expect((await call("?months=abc")).status).toBe(400);
    expect((await call("?months=1.5")).status).toBe(400);
    expect((await (await call()).json()).data.months).toHaveLength(6);
  });

  it("the browser route answers the same view", async () => {
    const { GET } = await import("@/app/api/savings-rate/route");
    await add("income", 100000, 0);
    await add("expense", 25000, 0);
    sessionUser.current = { id: userId, name: "SR User", email: "sr@x.com", role: "user" };
    const res = await GET(new NextRequest("http://localhost/api/savings-rate?months=2"));
    expect(res.status).toBe(200);
    expect((await res.json()).data.current).toMatchObject({ income: 100000, expense: 25000, rate: 0.75 });
    expect((await GET(new NextRequest("http://localhost/api/savings-rate?months=99"))).status).toBe(400);
    sessionUser.current = null;
    expect((await GET(new NextRequest("http://localhost/api/savings-rate"))).status).toBe(401);
  });
});

describe("integration card rewards", () => {
  const KEY = "test-card-rewards-api-key";
  let userId: string;
  let cardId: string;
  let n = 0;

  async function makeCard(user: string, over: Record<string, unknown> = {}) {
    const { default: Account } = await import("@/models/Account");
    const card = await Account.create({
      user,
      name: "Axis Magnus",
      type: "credit_card",
      balance: 0,
      currency: "INR",
      creditMeta: { billingCycleDay: 5, paymentDueDay: 25, creditLimit: 1_000_000, lastFourDigits: "4242" },
      ...over,
    });
    return card._id.toString();
  }

  async function spendOn(account: string, amount: number, category: string, extra: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.create({ user: userId, account, type: "expense", amount, category, date: new Date(), ...extra });
  }

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Rewards", email: `rw${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    cardId = await makeCard(userId);
  });

  function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/credit-cards${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `rw-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ accountId: id }) });
  const card = async () => await import("@/app/api/integrations/credit-cards/[accountId]/rewards/route");
  const getCard = async (id = cardId, query = "") => (await card()).GET(req(`/${id}/rewards${query}`), ctx(id));
  const putRule = async (body: unknown, id = cardId, headers: Record<string, string> = {}) =>
    (await card()).PUT(req(`/${id}/rewards`, "PUT", body, headers), ctx(id));

  it("a card with no rule says so, and an overview lists it", async () => {
    const res = await getCard();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ accountId: cardId, name: "Axis Magnus", lastFourDigits: "4242", rule: null, reason: "no_rule", cycles: [], total: null });

    const { GET } = await import("@/app/api/integrations/credit-cards/rewards/route");
    const overview = (await (await GET(req("/rewards"), {})).json()).data;
    expect(overview.currentValue).toBe(0);
    expect(overview.cards).toHaveLength(1);
    expect(overview.cards[0]).toMatchObject({ accountId: cardId, reason: "no_rule" });
  });

  it("PUT validates the rule and the key", async () => {
    for (const bad of [
      {},
      { kind: "cashback", baseRate: 150 },
      { kind: "cashback", baseRate: 1, pointValue: 25 },
      { kind: "points", baseRate: 1, categoryRates: [{ category: "a", rate: 1 }, { category: "A", rate: 2 }] },
      { kind: "cashback", baseRate: 1, other: true },
    ]) {
      expect((await putRule(bad)).status).toBe(400);
    }
    const { PUT } = await card();
    const noKey = await PUT(
      new NextRequest("http://localhost/x", {
        method: "PUT",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "cashback", baseRate: 1 }),
      }),
      ctx(cardId)
    );
    expect(noKey.status).toBe(400);
  });

  it("PUT stores the rule, replays on the same key, refuses the same key with another body", async () => {
    const rule = { kind: "cashback", baseRate: 1.5, categoryRates: [{ category: "Fuel", rate: 5 }], cap: 100000 };
    const first = await putRule(rule, cardId, { "idempotency-key": "set-rule" });
    expect(first.status).toBe(200);
    expect((await first.json()).data.rule).toEqual({ kind: "cashback", baseRate: 1.5, categoryRates: [{ category: "fuel", rate: 5 }], cap: 100000, pointValue: null });

    const replay = await putRule(rule, cardId, { "idempotency-key": "set-rule" });
    expect(replay.status).toBe(200);
    const other = await putRule({ ...rule, baseRate: 2 }, cardId, { "idempotency-key": "set-rule" });
    expect(other.status).toBe(409);

    const got = (await (await getCard()).json()).data;
    expect(got.rule.baseRate).toBe(1.5);
    expect(got.reason).toBeNull();
  });

  it("estimates the current cycle: category rates, a cap and a confirmed refund", async () => {
    await putRule({ kind: "cashback", baseRate: 1, categoryRates: [{ category: "fuel", rate: 5 }], cap: 5_500 });
    await spendOn(cardId, 100_000, "Fuel"); // 5,000
    await spendOn(cardId, 100_000, "food"); // 1,000
    await spendOn(cardId, 50_000, "food"); // 500
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.create({ user: userId, account: cardId, type: "income", amount: 50_000, category: "food", date: new Date(), refundStatus: "confirmed" }); // -500
    await Transaction.create({ user: userId, account: cardId, type: "income", amount: 90_000, category: "payment", date: new Date() }); // a card payment: ignored

    const data = (await (await getCard(cardId, "?cycles=2")).json()).data;
    expect(data.cycles).toHaveLength(2);
    const current = data.cycles[0];
    expect(current).toMatchObject({ isCurrent: true, unit: "paise", spend: 250_000, refunded: 50_000, uncapped: 6_000, earned: 5_500, capReached: true, value: 5_500 });
    expect(current.byCategory.map((c: { category: string; earned: number }) => [c.category, c.earned])).toEqual([["fuel", 5_000], ["food", 1_000]]);
    expect(data.cycles[1]).toMatchObject({ isCurrent: false, earned: 0 });
    expect(data.total).toEqual({ earned: 5_500, value: 5_500 });
  });

  it("a voided row (a duplicate or not a transaction) earns nothing", async () => {
    await putRule({ kind: "cashback", baseRate: 10 });
    await spendOn(cardId, 20_000, "food");
    await spendOn(cardId, 80_000, "food", { reviewStatus: "voided" });
    const cycle = (await (await getCard(cardId, "?cycles=1")).json()).data.cycles[0];
    expect(cycle).toMatchObject({ spend: 20_000, earned: 2_000 });
  });

  it("points rules count points and value them", async () => {
    await putRule({ kind: "points", baseRate: 4, pointValue: 50 });
    await spendOn(cardId, 250_000, "travel");
    const cycle = (await (await getCard(cardId, "?cycles=1")).json()).data.cycles[0];
    expect(cycle).toMatchObject({ unit: "points", earned: 100, value: 5_000 });
  });

  it("only this card's own spending counts", async () => {
    const { default: Account } = await import("@/models/Account");
    const other = await makeCard(userId, { name: "Other card" });
    await putRule({ kind: "cashback", baseRate: 10 });
    await spendOn(other, 100_000, "food");
    await spendOn(cardId, 20_000, "food");
    void Account;
    const cycle = (await (await getCard(cardId, "?cycles=1")).json()).data.cycles[0];
    expect(cycle).toMatchObject({ spend: 20_000, earned: 2_000 });
  });

  it("a card without a billing cycle says why there is no estimate", async () => {
    const bare = await makeCard(userId, { name: "Bare", creditMeta: { creditLimit: 100_000 } });
    expect((await putRule({ kind: "cashback", baseRate: 1 }, bare)).status).toBe(200);
    expect((await (await getCard(bare)).json()).data).toMatchObject({ reason: "billing_cycle_not_set", cycles: [], total: null });
  });

  it("DELETE removes the rule", async () => {
    await putRule({ kind: "cashback", baseRate: 1 });
    const { DELETE } = await card();
    const res = await DELETE(req(`/${cardId}/rewards`, "DELETE"), ctx(cardId));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: cardId, deleted: true });
    expect((await (await getCard()).json()).data.rule).toBeNull();
  });

  it("overview adds up what the current cycles are worth", async () => {
    const second = await makeCard(userId, { name: "Second" });
    await putRule({ kind: "cashback", baseRate: 1 });
    await putRule({ kind: "cashback", baseRate: 2 }, second);
    await spendOn(cardId, 100_000, "food"); // 1,000
    await spendOn(second, 100_000, "food"); // 2,000
    const { GET } = await import("@/app/api/integrations/credit-cards/rewards/route");
    const data = (await (await GET(req("/rewards"), {})).json()).data;
    expect(data.currentValue).toBe(3_000);
    expect(data.cards).toHaveLength(2);
  });

  it("rejects other people's cards, non-cards, archived cards and bad ids", async () => {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const stranger = await User.create({ name: "S", email: `s${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const theirs = await makeCard(stranger._id.toString());
    expect((await getCard(theirs)).status).toBe(404);
    expect((await putRule({ kind: "cashback", baseRate: 1 }, theirs)).status).toBe(404);
    const { DELETE } = await card();
    expect((await DELETE(req(`/${theirs}/rewards`, "DELETE"), ctx(theirs))).status).toBe(404);

    const bank = await Account.create({ user: userId, name: "Bank", type: "bank", balance: 0, currency: "INR" });
    expect((await getCard(bank._id.toString())).status).toBe(400);

    await Account.updateOne({ _id: cardId }, { isArchived: true });
    expect((await getCard()).status).toBe(404);

    expect((await getCard("not-an-id")).status).toBe(400);
    expect((await getCard(cardId, "?cycles=0")).status).toBe(400);
    expect((await getCard(cardId, "?cycles=13")).status).toBe(400);
  });

  it("answers 401 without an API key", async () => {
    const { GET } = await card();
    const res = await GET(new NextRequest("http://localhost/x"), ctx(cardId));
    expect(res.status).toBe(401);
  });
});

describe("browser card rewards routes", () => {
  let userId: string;
  let cardId: string;

  beforeEach(async () => {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "Browser", email: `br${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    userId = user._id.toString();
    sessionUser.current = { id: userId, name: "Browser", email: user.email, role: "user" };
    const card = await Account.create({
      user: user._id,
      name: "Card",
      type: "credit_card",
      balance: 0,
      currency: "INR",
      creditMeta: { billingCycleDay: 5, paymentDueDay: 25, creditLimit: 100_000 },
    });
    cardId = card._id.toString();
  });
  afterEach(() => {
    sessionUser.current = null;
  });

  const ctx = () => ({ params: Promise.resolve({ accountId: cardId }) });
  const json = (method: string, body?: unknown) =>
    new NextRequest("http://localhost/api/credit-cards/x/rewards", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("sets, reads and clears a rule for the signed-in user", async () => {
    const { GET, PUT, DELETE } = await import("@/app/api/credit-cards/[accountId]/rewards/route");
    expect((await PUT(json("PUT", { kind: "cashback", baseRate: 2 }), ctx())).status).toBe(200);
    expect((await (await GET(json("GET"), ctx())).json()).rule).toMatchObject({ kind: "cashback", baseRate: 2 });
    expect((await PUT(json("PUT", { kind: "cashback", baseRate: 500 }), ctx())).status).toBe(400);
    expect((await DELETE(json("DELETE"), ctx())).status).toBe(200);
    expect((await (await GET(json("GET"), ctx())).json()).rule).toBeNull();
  });

  it("lists every card in the overview, and signed-out gets 401", async () => {
    const { GET } = await import("@/app/api/credit-cards/rewards/route");
    const data = await (await GET()).json();
    expect(data.cards).toHaveLength(1);
    sessionUser.current = null;
    expect((await GET()).status).toBe(401);
  });
});


describe("net worth", () => {
  const KEY = "test-net-worth-api-key";
  let userId: string;
  let otherUserId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "NW User", email: `nw${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "NW Other", email: `nwo${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/net-worth${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `nw-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const getReport = async (query = "") => {
    const { GET } = await import("@/app/api/integrations/net-worth/route");
    const res = await GET(req(query), {});
    expect(res.status).toBe(200);
    return (await res.json()).data as {
      assets: number; liabilities: number; netWorth: number;
      breakdown: { assets: { key: string; amount: number; count: number }[]; liabilities: { key: string; amount: number }[] };
      range: string;
      history: { date: string; netWorth: number }[];
      change: { amount: number; percent: number | null; since: string | null };
    };
  };

  async function seed(user: string) {
    const { default: Account } = await import("@/models/Account");
    const { default: Loan } = await import("@/models/Loan");
    const { default: ManualAsset } = await import("@/models/ManualAsset");
    await Account.create([
      { user, name: "Bank", type: "bank", balance: 100000 },
      { user, name: "Savings", type: "savings", balance: 50000 },
      { user, name: "Cash", type: "cash", balance: 20000 },
      { user, name: "Card", type: "credit_card", balance: -30000 },
      { user, name: "Overdrawn", type: "bank", balance: -5000 },
      { user, name: "Old", type: "bank", balance: 999999, isArchived: true },
    ]);
    const base = { user, startDate: new Date(), principalAmount: 100000 };
    await Loan.create([
      { ...base, direction: "given", counterparty: "Friend", remainingAmount: 40000 },
      { ...base, direction: "received", counterparty: "Bank loan", remainingAmount: 25000 },
      { ...base, direction: "received", counterparty: "Paid off", remainingAmount: 0, isSettled: true },
      { ...base, direction: "given", counterparty: "Removed", remainingAmount: 77777, isDeleted: true },
    ]);
    await ManualAsset.create([
      { user, name: "Gold", kind: "gold", value: 70000 },
      { user, name: "Sold car", kind: "vehicle", value: 500000, isArchived: true },
    ]);
  }

  it("needs an API key", async () => {
    const { GET } = await import("@/app/api/integrations/net-worth/route");
    const res = await GET(new NextRequest("http://localhost/api/integrations/net-worth"), {});
    expect(res.status).toBe(401);
  });

  it("is zero with nothing to count, and still returns today's point", async () => {
    const r = await getReport();
    expect(r).toMatchObject({ assets: 0, liabilities: 0, netWorth: 0, range: "90d" });
    expect(r.breakdown).toEqual({ assets: [], liabilities: [] });
    expect(r.history).toHaveLength(1);
    expect(r.change).toEqual({ amount: 0, percent: null, since: null });
  });

  it("adds up accounts, loans both ways, cards as debt and manual assets, skipping archived, settled and deleted", async () => {
    await seed(userId);
    await seed(otherUserId); // someone else's money never counts
    const r = await getReport();
    expect(r.assets).toBe(100000 + 50000 + 20000 + 40000 + 70000);
    expect(r.liabilities).toBe(30000 + 5000 + 25000);
    expect(r.netWorth).toBe(280000 - 60000);
    expect(r.breakdown.assets.map((b) => [b.key, b.amount])).toEqual([
      ["bank", 100000],
      ["savings", 50000],
      ["cash", 20000],
      ["loansGiven", 40000],
      ["manual", 70000],
    ]);
    expect(r.breakdown.liabilities.map((b) => [b.key, b.amount])).toEqual([
      ["cards", 30000],
      ["overdrafts", 5000],
      ["loansReceived", 25000],
    ]);
  });

  it("a card with a credit balance counts as an asset", async () => {
    const { default: Account } = await import("@/models/Account");
    await Account.create({ user: userId, name: "Card", type: "credit_card", balance: 1200 });
    const r = await getReport();
    expect(r.breakdown.assets).toEqual([{ key: "cardCredit", label: "Card credit balances", amount: 1200, count: 1 }]);
    expect(r.liabilities).toBe(0);
  });

  it("returns the trend oldest first, filtered by range, with the change since the first point", async () => {
    await seed(userId);
    const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
    const { localDayKey } = await import("@/lib/net-worth");
    const day = (ago: number) => localDayKey(new Date(Date.now() - ago * 86400000), "Asia/Kolkata");
    await NetWorthSnapshot.create([
      { user: userId, day: day(200), assets: 1, liabilities: 0, netWorth: 1 },
      { user: userId, day: day(20), assets: 200000, liabilities: 60000, netWorth: 140000 },
      { user: userId, day: day(5), assets: 250000, liabilities: 60000, netWorth: 190000 },
      { user: otherUserId, day: day(5), assets: 9, liabilities: 0, netWorth: 9 },
    ]);

    const r30 = await getReport("?range=30d");
    expect(r30.range).toBe("30d");
    expect(r30.history.map((p) => p.netWorth)).toEqual([140000, 190000, 220000]);
    expect(r30.history.map((p) => p.date)).toEqual([day(20), day(5), day(0)]);
    expect(r30.change).toEqual({ amount: 80000, percent: 57.1, since: day(20) });

    const all = await getReport("?range=all");
    expect(all.history).toHaveLength(4);
    expect(all.history[0].netWorth).toBe(1);

    const odd = await getReport("?range=nonsense");
    expect(odd.range).toBe("90d");
    expect(odd.history).toHaveLength(3);
  });

  it("reading twice in a day keeps one point for the day", async () => {
    await seed(userId);
    await getReport();
    await getReport();
    const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
    expect(await NetWorthSnapshot.countDocuments({ user: userId })).toBe(1);
  });

  it("the day follows the user's time zone", async () => {
    const { localDayKey } = await import("@/lib/net-worth");
    const instant = new Date("2026-03-01T20:00:00Z"); // 01:30 on 2 March in Kolkata, still 1 March in UTC and New York
    expect(localDayKey(instant, "Asia/Kolkata")).toBe("2026-03-02");
    expect(localDayKey(instant, "UTC")).toBe("2026-03-01");
    expect(localDayKey(instant, "America/New_York")).toBe("2026-03-01");
    expect(localDayKey(instant, "Not/AZone")).toBe("2026-03-02");
    expect(localDayKey(instant, undefined)).toBe("2026-03-02");
  });

  describe("manual assets", () => {
    const list = async () => {
      const { GET } = await import("@/app/api/integrations/net-worth/assets/route");
      return (await (await GET(req("/assets"), {})).json()).data as { id: string; name: string; value: number; kind: string; note: string | null }[];
    };
    const create = async (body: unknown, headers: Record<string, string> = {}) => {
      const { POST } = await import("@/app/api/integrations/net-worth/assets/route");
      return POST(req("/assets", "POST", body, headers), {});
    };

    it("creates with an Idempotency-Key and replays the same answer", async () => {
      const first = await create({ name: "Flat", kind: "property", value: 5000000, note: "Pune" }, { "idempotency-key": "asset-1" });
      expect(first.status).toBe(201);
      const asset = (await first.json()).data;
      expect(asset).toMatchObject({ name: "Flat", kind: "property", value: 5000000, note: "Pune" });
      const replay = await create({ name: "Flat", kind: "property", value: 5000000, note: "Pune" }, { "idempotency-key": "asset-1" });
      expect((await replay.json()).data.id).toBe(asset.id);
      expect(await list()).toHaveLength(1);
      expect((await getReport()).netWorth).toBe(5000000);
      const clash = await create({ name: "Other", value: 1 }, { "idempotency-key": "asset-1" });
      expect(clash.status).toBe(409);
    });

    it("rejects a missing key and bad data", async () => {
      expect((await create({ name: "Flat", value: 1 }, { "idempotency-key": "" })).status).toBe(400);
      expect((await create({ name: "", value: 1 })).status).toBe(400);
      expect((await create({ name: "Flat", value: -5 })).status).toBe(400);
      expect((await create({ name: "Flat", value: 1.5 })).status).toBe(400);
      expect((await create({ name: "Flat", value: 1, kind: "boat" })).status).toBe(400);
    });

    it("edits, clears the note, and archives so it stops counting", async () => {
      const { PATCH, DELETE } = await import("@/app/api/integrations/net-worth/assets/[id]/route");
      const made = (await (await create({ name: "Gold", kind: "gold", value: 100000, note: "coins" })).json()).data;

      const edited = await PATCH(req(`/assets/${made.id}`, "PATCH", { value: 150000, note: null }), ctx(made.id));
      expect(edited.status).toBe(200);
      expect((await edited.json()).data).toMatchObject({ value: 150000, note: null, name: "Gold" });
      expect((await getReport()).assets).toBe(150000);

      expect((await PATCH(req(`/assets/${made.id}`, "PATCH", {}), ctx(made.id))).status).toBe(400);
      expect((await PATCH(req(`/assets/${made.id}`, "PATCH", { value: -1 }), ctx(made.id))).status).toBe(400);
      expect((await PATCH(req(`/assets/nope`, "PATCH", { value: 1 }), ctx("nope"))).status).toBe(400);

      const gone = await DELETE(req(`/assets/${made.id}`, "DELETE"), ctx(made.id));
      expect(gone.status).toBe(200);
      expect((await gone.json()).data).toEqual({ id: made.id, deleted: true });
      expect(await list()).toEqual([]);
      expect((await getReport()).assets).toBe(0);
      expect((await DELETE(req(`/assets/${made.id}`, "DELETE"), ctx(made.id))).status).toBe(404);
    });

    it("never touches or lists another user's assets", async () => {
      const { default: ManualAsset } = await import("@/models/ManualAsset");
      const theirs = await ManualAsset.create({ user: otherUserId, name: "Theirs", value: 10 });
      const id = theirs._id.toString();
      const { PATCH, DELETE } = await import("@/app/api/integrations/net-worth/assets/[id]/route");
      expect((await PATCH(req(`/assets/${id}`, "PATCH", { value: 5 }), ctx(id))).status).toBe(404);
      expect((await DELETE(req(`/assets/${id}`, "DELETE"), ctx(id))).status).toBe(404);
      expect(await list()).toEqual([]);
      expect((await ManualAsset.findById(id).lean<{ value: number; isArchived: boolean }>())).toMatchObject({ value: 10, isArchived: false });
    });
  });

  describe("snapshots for everyone and the cron route", () => {
    it("records a point for each active user that has something, and skips the rest", async () => {
      await seed(userId);
      const { default: User } = await import("@/models/User");
      await User.create({ name: "Inactive", email: `nwi${Date.now()}@x.com`, password: "hash", isActive: false });
      const { default: Account } = await import("@/models/Account");
      const inactive = await User.findOne({ name: "Inactive" });
      await Account.create({ user: inactive!._id, name: "Bank", type: "bank", balance: 5 });
      const { recordSnapshotsForAllUsers } = await import("@/lib/net-worth");
      const out = await recordSnapshotsForAllUsers();
      expect(out).toEqual({ checked: 2, recorded: 1 }); // the key's second user (otherUser) has nothing; the inactive one is skipped
      const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
      const rows = await NetWorthSnapshot.find({}).lean<{ user: { toString(): string }; netWorth: number }[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0].user.toString()).toBe(userId);
      expect(rows[0].netWorth).toBe(220000);
    });

    it("a user who cleared everything gets a zero point, so the trend does not keep an old value", async () => {
      const { default: Account } = await import("@/models/Account");
      const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
      const { recordSnapshotsForAllUsers } = await import("@/lib/net-worth");
      const bank = await Account.create({ user: userId, name: "Bank", type: "bank", balance: 5000 });
      await getReport(); // stores today's point at 5000
      await Account.updateOne({ _id: bank._id }, { $set: { balance: 0 } });
      const out = await recordSnapshotsForAllUsers();
      expect(out).toEqual({ checked: 2, recorded: 1 }); // the other user never had a point and has nothing
      const rows = await NetWorthSnapshot.find({ user: userId }).lean<{ netWorth: number }[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0].netWorth).toBe(0);
    });

    it("an overlapping run does nothing instead of running twice", async () => {
      const { recordSnapshotsForAllUsers } = await import("@/lib/net-worth");
      const [first, second] = await Promise.all([recordSnapshotsForAllUsers(), recordSnapshotsForAllUsers()]);
      expect([first.skipped, second.skipped].filter(Boolean)).toHaveLength(1);
      expect((await recordSnapshotsForAllUsers()).skipped).toBeUndefined(); // the guard is released afterwards
    });

    it("a hung pass stops blocking new ones after ten minutes", async () => {
      const { default: User } = await import("@/models/User");
      const { recordSnapshotsForAllUsers } = await import("@/lib/net-worth");
      const hang = vi.spyOn(User, "find").mockImplementationOnce((() => ({
        select: () => ({ lean: () => ({ cursor: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) }) }),
      })) as never);
      void recordSnapshotsForAllUsers(); // hangs on its first read of the cursor, and never finishes
      await new Promise((r) => setTimeout(r, 25));
      expect((await recordSnapshotsForAllUsers()).skipped).toBe(true); // still within the deadline
      hang.mockRestore();
      const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
      try {
        const out = await recordSnapshotsForAllUsers();
        expect(out.skipped).toBeUndefined(); // treated as stale: a new pass runs
        expect(out.checked).toBeGreaterThan(0);
      } finally {
        later.mockRestore();
      }
    });

    it("an account saved before the archived flag existed still counts", async () => {
      const { default: Account } = await import("@/models/Account");
      const old = await Account.create({ user: userId, name: "Legacy", type: "bank", balance: 7000 });
      await Account.collection.updateOne({ _id: old._id }, { $unset: { isArchived: "" } });
      expect((await getReport()).assets).toBe(7000);
    });

    it("a point written at the same moment by another request does not fail the read", async () => {
      const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
      const { Types } = await import("mongoose");
      const { recordSnapshot } = await import("@/lib/net-worth");
      await NetWorthSnapshot.init(); // the unique (user, day) index must exist for a real duplicate
      const first = await recordSnapshot(userId); // today's row now exists
      const real = NetWorthSnapshot.updateOne.bind(NetWorthSnapshot);
      let calls = 0;
      const spy = vi.spyOn(NetWorthSnapshot, "updateOne").mockImplementation(((...args: Parameters<typeof real>) => {
        calls += 1;
        if (calls > 1) return real(...args);
        // A genuine duplicate-key error from MongoDB: insert the same (user, day) a second time.
        return NetWorthSnapshot.collection.insertOne({ user: new Types.ObjectId(userId), day: first.date }) as never;
      }) as never);
      try {
        const again = await recordSnapshot(userId);
        expect(calls).toBe(2); // the duplicate was hit, then the write was retried once
        expect(again.date).toBe(first.date);
      } finally {
        spy.mockRestore();
      }
      expect(await NetWorthSnapshot.countDocuments({ user: userId })).toBe(1);
    });

    it("an error that is not a duplicate key is not retried and reaches the caller", async () => {
      const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
      const { recordSnapshot } = await import("@/lib/net-worth");
      for (const code of [undefined, 11001, 12345]) {
        let calls = 0;
        const boom = Object.assign(new Error("write failed"), code === undefined ? {} : { code });
        const spy = vi.spyOn(NetWorthSnapshot, "updateOne").mockImplementation((() => {
          calls += 1;
          return Promise.reject(boom) as never;
        }) as never);
        try {
          await expect(recordSnapshot(userId)).rejects.toBe(boom);
          expect(calls).toBe(1); // no second attempt
        } finally {
          spy.mockRestore();
        }
      }
    });

    it("a second duplicate-key error is not swallowed either", async () => {
      const { default: NetWorthSnapshot } = await import("@/models/NetWorthSnapshot");
      const { recordSnapshot } = await import("@/lib/net-worth");
      const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      let calls = 0;
      const spy = vi.spyOn(NetWorthSnapshot, "updateOne").mockImplementation((() => {
        calls += 1;
        return Promise.reject(dup) as never;
      }) as never);
      try {
        await expect(recordSnapshot(userId)).rejects.toBe(dup);
        expect(calls).toBe(2); // one retry, then it gives up
      } finally {
        spy.mockRestore();
      }
    });

    it("the cron route needs the secret", async () => {
      process.env.CRON_SECRET = "cron-secret-for-tests";
      const { GET } = await import("@/app/api/cron/net-worth-snapshot/route");
      const call = (headers: Record<string, string> = {}) =>
        GET(new NextRequest("http://localhost/api/cron/net-worth-snapshot", { headers }));
      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
      const ok = await call({ authorization: "Bearer cron-secret-for-tests" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, checked: 2, recorded: 0 });
    });
  });

  describe("browser routes", () => {
    afterEach(() => {
      sessionUser.current = null;
    });

    it("GET /api/net-worth is the same report; the asset routes work on the session user", async () => {
      sessionUser.current = { id: userId, name: "NW", email: "nw@x.com", role: "user" };
      await seed(userId);
      const { GET } = await import("@/app/api/net-worth/route");
      const res = await GET(new NextRequest("http://localhost/api/net-worth?range=30d"));
      const body = (await res.json()).data;
      expect(body).toMatchObject({ netWorth: 220000, range: "30d" });

      const assets = await import("@/app/api/net-worth/assets/route");
      const made = await assets.POST(
        new NextRequest("http://localhost/api/net-worth/assets", { method: "POST", body: JSON.stringify({ name: "Car", kind: "vehicle", value: 30000 }) })
      );
      expect(made.status).toBe(201);
      const id = (await made.json()).data.id;
      expect((await (await assets.GET()).json()).data.map((a: { name: string }) => a.name).sort()).toEqual(["Car", "Gold"]);

      const one = await import("@/app/api/net-worth/assets/[id]/route");
      const patched = await one.PATCH(
        new NextRequest(`http://localhost/api/net-worth/assets/${id}`, { method: "PATCH", body: JSON.stringify({ value: 40000 }) }),
        ctx(id)
      );
      expect((await patched.json()).data.value).toBe(40000);
      expect((await one.DELETE(new NextRequest(`http://localhost/api/net-worth/assets/${id}`, { method: "DELETE" }), ctx(id))).status).toBe(200);
      expect((await one.DELETE(new NextRequest(`http://localhost/api/net-worth/assets/nope`, { method: "DELETE" }), ctx("nope"))).status).toBe(404);
    });

    it("needs a signed-in user", async () => {
      sessionUser.current = null;
      const { GET } = await import("@/app/api/net-worth/route");
      expect((await GET(new NextRequest("http://localhost/api/net-worth"))).status).toBe(401);
    });
  });
});


describe("weekly review", () => {
  const KEY = "test-weekly-review-api-key";
  // Monday 5 Jan to Sunday 11 Jan 2026 on the Kolkata clock (the default zone).
  const WEEK = "2026-01-07";
  const at = (day: number, hour = 12, month = "01") =>
    new Date(`2026-${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+05:30`);
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let otherAccountId: string;
  let n = 0;
  // Integration handlers take the route context as a second argument; none of these routes use one.
  const run = (handler: (r: NextRequest, ctx: never) => Promise<Response>, r: NextRequest) => handler(r, undefined as never);

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Review User", email: `wr${Date.now()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `wro${Date.now()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 1000000, currency: "INR" });
    const otherAccount = await Account.create({ user: other._id, name: "Bank", type: "bank", balance: 1000000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
    otherAccountId = otherAccount._id.toString();
  });

  function req(path: string, method: "GET" | "PATCH" = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/weekly-review${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        ...(method === "GET" ? {} : { "idempotency-key": `wr-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function txn(over: Record<string, unknown> = {}, owner = userId, account = accountId) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({ user: owner, account, type: "expense", amount: 10000, category: "Food", date: at(6), ...over });
  }

  it("needs an API key", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    const res = await run(GET, new NextRequest(`http://localhost/api/integrations/weekly-review?week=${WEEK}`));
    expect(res.status).toBe(401);
  });

  it("returns the week with totals, change, categories, days and highlights, for this user only", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    await txn({ amount: 120000, category: "Food", description: "Swiggy", date: at(6) });
    await txn({ amount: 250000, category: "Shopping", description: "Amazon", date: at(7) });
    await txn({ amount: 900000, type: "income", category: "Salary", date: at(8) });
    await txn({ amount: 300000, category: "Food", date: at(1) }); // the week before (29 Dec to 4 Jan)
    await txn({ amount: 777777, category: "Food", date: at(6) }, otherUserId, otherAccountId); // someone else's

    const res = await run(GET, req(`?week=${WEEK}`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.week).toMatchObject({ startDate: "2026-01-05", endDate: "2026-01-11", timeZone: "Asia/Kolkata", isComplete: true });
    expect(data.totals).toMatchObject({ spent: 370000, income: 900000, net: 530000, previousSpent: 300000 });
    expect(data.totals.change).toEqual({ amount: 70000, percent: 23 });
    expect(data.topCategories.map((c: { category: string }) => c.category)).toEqual(["Shopping", "Food"]);
    expect(data.topMerchants[0]).toMatchObject({ merchant: "Amazon", total: 250000 });
    expect(data.biggestExpense).toMatchObject({ amount: 250000, category: "Shopping" });
    expect(data.days).toHaveLength(7);
    expect(data.days[1]).toEqual({ date: "2026-01-06", spent: 120000 });
    expect(data.noSpendDays).toBe(5);
    expect(data.highlights[0]).toBe("You spent ₹700.00 more than the week before (up 23%).");
    expect(data.settings).toEqual({ enabled: false, day: 1 });
    expect(data.spendLimit).toBeNull();
    expect(data.budgets).toBeNull();
  });

  it("an empty week is zeros with a plain highlight", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    const { data } = await (await run(GET, req(`?week=${WEEK}`))).json();
    expect(data.totals).toMatchObject({ spent: 0, income: 0, previousSpent: 0 });
    expect(data.biggestExpense).toBeNull();
    expect(data.noSpendDays).toBe(7);
    expect(data.highlights).toEqual(["No spending recorded this week."]);
  });

  it("defaults to the last completed week, a Monday to Sunday that has ended", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    const { data } = await (await run(GET, req(""))).json();
    expect(data.week.isComplete).toBe(true);
    const start = new Date(data.week.start);
    const end = new Date(data.week.end);
    expect(end.getTime()).toBeLessThanOrEqual(Date.now());
    expect(end.getTime() - start.getTime()).toBeGreaterThanOrEqual(7 * 23 * 3600_000);
    expect(new Date(`${data.week.startDate}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it("refuses a bad or future week", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    for (const bad of ["nope", "2026-13-01", "2026-02-30", "2099-01-05"]) {
      const res = await run(GET, req(`?week=${bad}`));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("brings the budgets, the spend limit result and the review queue with it", async () => {
    const { GET } = await import("@/app/api/integrations/weekly-review/route");
    const { default: Budget } = await import("@/models/Budget");
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    await Budget.create({ user: userId, category: "Food", month: 1, year: 2026, limitAmount: 100000, alertAt: 80 });
    await Budget.create({ user: userId, category: "Shopping", month: 1, year: 2026, limitAmount: 1000000, alertAt: 80 });
    await SpendLimit.create({ user: userId, dailyAmount: 100000, alertAt: 80, excludeCategories: [], rollover: false });
    await txn({ amount: 150000, category: "Food", date: at(6) }); // over its budget and the day's limit
    await txn({ amount: 50000, category: "Shopping", date: at(7) });
    await txn({ amount: 20000, category: "Food", date: at(30, 12, "01"), reviewStatus: "unreviewed", source: "sms" }); // unreviewed, in a later week
    const { data } = await (await run(GET, req(`?week=${WEEK}`))).json();

    expect(data.budgets).toMatchObject({ month: 1, year: 2026, total: 2, over: 1, near: 0 });
    expect(data.budgets.items[0]).toMatchObject({ category: "Food", spent: 170000, limit: 100000, percent: 170 });
    expect(data.spendLimit).toEqual({ dailyAmount: 100000, daysWithin: 6, daysOver: 1, daysTracked: 7 });
    expect(data.unreviewed).toBe(1);
  });

  it("judges past days against the limit that was in force then", async () => {
    const { getWeeklyReview } = await import("@/lib/weekly-review");
    const { updateSpendLimit } = await import("@/lib/spend-limit");
    // 80,000 on Monday 5 Jan and on Friday 9 Jan; the limit goes 70,000 to 100,000 from Thursday 8 Jan.
    await txn({ amount: 80000, date: at(5) });
    await txn({ amount: 80000, date: at(9) });
    await updateSpendLimit(userId, { dailyAmount: 70000 }, at(1));
    await updateSpendLimit(userId, { dailyAmount: 100000 }, at(8, 9));
    const review = await getWeeklyReview(userId, { week: WEEK, now: at(14) });
    expect(review.spendLimit).toEqual({ dailyAmount: 100000, daysWithin: 6, daysOver: 1, daysTracked: 7 });
  });

  describe("settings", () => {
    it("starts off, on Monday", async () => {
      const { GET } = await import("@/app/api/integrations/weekly-review/settings/route");
      const res = await run(GET, req("/settings"));
      expect((await res.json()).data).toEqual({ enabled: false, day: 1 });
    });

    it("saves only what is sent, validates, and replays an idempotency key", async () => {
      const { PATCH } = await import("@/app/api/integrations/weekly-review/settings/route");
      const on = await run(PATCH, req("/settings", "PATCH", { enabled: true }));
      expect(on.status).toBe(200);
      expect((await on.json()).data).toEqual({ enabled: true, day: 1 });
      const sunday = await run(PATCH, req("/settings", "PATCH", { day: 0 }));
      expect((await sunday.json()).data).toEqual({ enabled: true, day: 0 });

      for (const bad of [{}, { day: 7 }, { day: -1 }, { day: 1.5 }, { enabled: "yes" }, { other: 1 }]) {
        expect((await run(PATCH, req("/settings", "PATCH", bad))).status).toBe(400);
      }
      expect((await run(PATCH, req("/settings", "PATCH", { day: 2 }, { "idempotency-key": "" }))).status).toBe(400);

      const first = await run(PATCH, req("/settings", "PATCH", { day: 3 }, { "idempotency-key": "same-key" }));
      const replay = await run(PATCH, req("/settings", "PATCH", { day: 3 }, { "idempotency-key": "same-key" }));
      expect((await first.json()).data).toEqual((await replay.json()).data);
      const conflict = await run(PATCH, req("/settings", "PATCH", { day: 4 }, { "idempotency-key": "same-key" }));
      expect(conflict.status).toBe(409);
    });
  });

  describe("the notification", () => {
    // Tuesday 27 Oct 2026, 10:00 in Kolkata; the last completed week is 19 to 25 Oct.
    const now = new Date("2026-10-27T04:30:00Z");
    const early = new Date("2026-10-27T02:30:00Z"); // 08:00
    const tuesday = 2;
    const notices = async () => {
      const { default: Notification } = await import("@/models/Notification");
      return Notification.find({ user: userId, "meta.kind": "weekly_review" }).lean<Array<{ type: string; title: string; body: string }>>();
    };
    async function enable(day = tuesday) {
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: userId }, { $set: { "preferences.weeklyReview": { enabled: true, day } } });
    }

    it("sends once, on the chosen weekday from 09:00, with the week's spend and a highlight", async () => {
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      await enable();
      await txn({ amount: 100000, category: "Food", date: at(20, 12, "10") });
      await txn({ amount: 150000, category: "Food", date: at(14, 12, "10") }); // the week before

      expect(await sendWeeklyReviews(early)).toEqual({ checked: 1, sent: 0 });
      expect(await sendWeeklyReviews(now)).toEqual({ checked: 1, sent: 1 });
      expect(await sendWeeklyReviews(new Date(now.getTime() + 30 * 60_000))).toEqual({ checked: 1, sent: 0 });
      const sent = await notices();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "system", title: "Your week in review" });
      expect(sent[0].body).toBe("You spent ₹1,000.00 last week. You spent ₹500.00 less than the week before (down 33%).");

      // The next Tuesday is a new week with nothing in it: nothing is sent.
      expect((await sendWeeklyReviews(new Date(now.getTime() + 7 * 86_400_000))).sent).toBe(0);
    });

    it("two sends at the same moment create one notification", async () => {
      const { sendWeeklyReviewForUser } = await import("@/lib/weekly-review");
      const { default: Notification } = await import("@/models/Notification");
      await Notification.init(); // build the unique index the claim relies on
      await enable();
      await txn({ amount: 100000, category: "Food", date: at(20, 12, "10") });
      const settings = { enabled: true, day: tuesday };
      const sent = await Promise.all([sendWeeklyReviewForUser(userId, settings, now), sendWeeklyReviewForUser(userId, settings, now)]);
      expect(sent.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await notices()).toHaveLength(1);
    });

    it("an overlapping timer and cron run does nothing instead of running twice", async () => {
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      await enable();
      await txn({ amount: 100000, category: "Food", date: at(20, 12, "10") });
      const [a, b] = await Promise.all([sendWeeklyReviews(now), sendWeeklyReviews(now)]);
      expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
      expect(a.sent + b.sent).toBe(1);
      expect((await sendWeeklyReviews(new Date(now.getTime() + 30 * 60_000))).skipped).toBeUndefined();
    });

    it("a hung run stops blocking new ones after ten minutes", async () => {
      const { default: User } = await import("@/models/User");
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      const hang = vi.spyOn(User, "find").mockImplementationOnce((() => ({
        select: () => ({ lean: () => new Promise(() => {}) }),
      })) as never);
      void sendWeeklyReviews(now); // hangs on its user query and never finishes
      await new Promise((r) => setTimeout(r, 25));
      expect((await sendWeeklyReviews(now)).skipped).toBe(true); // still within the deadline
      hang.mockRestore();
      await enable();
      const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
      try {
        const out = await sendWeeklyReviews(now);
        expect(out.skipped).toBeUndefined(); // treated as stale: a new run goes ahead
        expect(out.checked).toBe(1);
      } finally {
        later.mockRestore();
      }
    });

    it("waits for the chosen weekday and skips an empty week", async () => {
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      await enable(5); // Friday
      await txn({ amount: 100000, date: at(20, 12, "10") });
      expect((await sendWeeklyReviews(now)).sent).toBe(0); // Tuesday
      await enable(tuesday);
      const { default: Transaction } = await import("@/models/Transaction");
      await Transaction.deleteMany({ user: userId });
      expect((await sendWeeklyReviews(now)).sent).toBe(0); // nothing happened that week
    });

    it("only checks users who turned it on", async () => {
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      await txn({ amount: 100000, date: at(20, 12, "10") });
      expect(await sendWeeklyReviews(now)).toEqual({ checked: 0, sent: 0 });
      expect(await notices()).toHaveLength(0);
    });

    it("uses each user's time zone for the weekday and 09:00", async () => {
      const { sendWeeklyReviews } = await import("@/lib/weekly-review");
      const { default: User } = await import("@/models/User");
      await enable();
      await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "America/New_York" } });
      await txn({ amount: 100000, date: new Date("2026-10-20T16:00:00Z") });
      // 10:00 Kolkata Tuesday is 00:30 Tuesday in New York: before 09:00.
      expect((await sendWeeklyReviews(now)).sent).toBe(0);
      // 14:00Z is 10:00 Tuesday in New York.
      expect((await sendWeeklyReviews(new Date("2026-10-27T14:00:00Z"))).sent).toBe(1);
    });

    it("the cron route needs the secret and reports what it did", async () => {
      process.env.CRON_SECRET = "cron-secret-for-tests";
      const { GET } = await import("@/app/api/cron/weekly-review/route");
      const call = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/cron/weekly-review", { headers }));
      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
      const ok = await call({ authorization: "Bearer cron-secret-for-tests" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, checked: 0, sent: 0 });
    });
  });

  it("the browser route returns the same review for the signed-in user", async () => {
    const { GET } = await import("@/app/api/weekly-review/route");
    sessionUser.current = null;
    expect((await GET(new NextRequest(`http://localhost/api/weekly-review?week=${WEEK}`))).status).toBe(401);
    sessionUser.current = { id: userId, name: "Review User", email: "wr@x.com", role: "user" };
    await txn({ amount: 50000, category: "Food", date: at(6) });
    const res = await GET(new NextRequest(`http://localhost/api/weekly-review?week=${WEEK}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data.totals.spent).toBe(50000);
    expect((await GET(new NextRequest("http://localhost/api/weekly-review?week=bad"))).status).toBe(400);
    sessionUser.current = null;
  });
});

// ── tags, split edits and receipts ─────────────────────────────────────────

describe("tags, split edits and receipts", () => {
  const KEY = "test-receipts-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let actor: { id: string; name: string; email: string; role: string };
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "TR User", email: `tr${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `tro${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = account._id.toString();
    actor = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
  });

  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("receipt-bytes-1234567890")]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);

  function req(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    const raw = Buffer.isBuffer(body);
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${KEY}`,
        ...(raw || body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { "idempotency-key": `tr-key-${n}` }),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function addTxn(over: Record<string, unknown> = {}, user: string = userId) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({ user, account: accountId, type: "expense", amount: 10000, currency: "INR", category: "food", date: new Date(2026, 9, 5, 12), ...over });
  }
  async function balance() {
    const { default: Account } = await import("@/models/Account");
    return (await Account.findById(accountId).lean<{ balance: number }>())!.balance;
  }
  async function fetchRoute(transactionId: string, bytes: Buffer, _key: string) {
    const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
    return POST(req(`transactions/${transactionId}/receipts`, "POST", bytes), ctx(transactionId));
  }

  describe("tags", () => {
    it("are lower-cased, trimmed and de-duplicated on create", async () => {
      const { transactionCreateSchema } = await import("@/lib/transaction-service");
      const parsed = transactionCreateSchema.parse({ accountId, type: "expense", amount: 100, category: "food", date: "2026-10-05", tags: ["  Trip ", "trip", "Work  Lunch"] });
      expect(parsed.tags).toEqual(["trip", "work lunch"]);
    });

    it("reject a colon, more than 10 tags and a long tag", async () => {
      const { transactionCreateSchema, transactionUpdateSchema } = await import("@/lib/transaction-service");
      const base = { accountId, type: "expense", amount: 100, category: "food", date: "2026-10-05" };
      expect(transactionCreateSchema.safeParse({ ...base, tags: ["repayment:abc"] }).success).toBe(false);
      expect(transactionCreateSchema.safeParse({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).success).toBe(false);
      expect(transactionCreateSchema.safeParse({ ...base, tags: ["x".repeat(41)] }).success).toBe(false);
      expect(transactionUpdateSchema.safeParse({ tags: ["loan:1"] }).success).toBe(false);
      expect(transactionUpdateSchema.safeParse({ tags: ["ok"] }).success).toBe(true);
    });

    it("an edit keeps the link tags the server wrote", async () => {
      const { updateTransaction } = await import("@/lib/transaction-service");
      const t = await addTxn({ tags: ["loan:abc", "loan_principal", "old"] });
      const res = await updateTransaction({ userId, transactionId: t._id.toString(), actor, tags: ["new"] });
      expect((res as { tags: string[] }).tags.sort()).toEqual(["loan:abc", "loan_principal", "new"]);
    });

    it("filter the list and the tag list leaves out link tags, voided and deleted rows", async () => {
      const { GET } = await import("@/app/api/integrations/transactions/route");
      const { GET: TAGS } = await import("@/app/api/integrations/transactions/tags/route");
      await addTxn({ tags: ["trip", "food"] });
      await addTxn({ tags: ["trip", "loan:x"] });
      await addTxn({ tags: ["work"], reviewStatus: "voided" });
      await addTxn({ tags: ["gone"], isDeleted: true });
      await addTxn({ tags: ["trip"] }, otherUserId);
      const list = await (await GET(req("transactions?tag=TRIP"), undefined as never)).json();
      expect(list.data.total).toBe(2);
      const tags = await (await TAGS(req("transactions/tags"), undefined as never)).json();
      expect(tags.data).toEqual([{ tag: "trip", count: 2 }, { tag: "food", count: 1 }]);
    });
  });

  describe("split edits", () => {
    async function makeSplit() {
      const { createTransaction } = await import("@/lib/transaction-service");
      const r = await createTransaction({
        userId, actor, accountId, type: "expense", amount: 30000, currency: "INR", description: "Mart", date: "2026-10-05T10:00:00.000Z",
        tags: [], isRecurring: false,
        splits: [{ category: "food", amount: 20000 }, { category: "home", amount: 10000 }],
      });
      if (r.kind !== "split") throw new Error("not a split");
      return { id: (r.transaction as { _id: { toString(): string } })._id.toString(), groupId: r.splitGroupId };
    }
    const put = async (id: string, splits: unknown) => {
      const { PUT } = await import("@/app/api/integrations/transactions/[id]/splits/route");
      return PUT(req(`transactions/${id}/splits`, "PUT", { splits }), ctx(id));
    };

    it("change the lines, keep the total and the balance", async () => {
      const { id } = await makeSplit();
      const before = await balance();
      const res = await put(id, [{ category: "food", amount: 5000 }, { category: "home", amount: 5000 }, { category: "fun", amount: 20000 }]);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.total).toBe(30000);
      expect(json.data.lines.map((l: { category: string; amount: number }) => [l.category, l.amount])).toEqual([["food", 5000], ["home", 5000], ["fun", 20000]]);
      expect(await balance()).toBe(before);
    });

    it("count each line under its own category in the month stats", async () => {
      const { getMonthlyStats } = await import("@/lib/stats-service");
      const { id } = await makeSplit();
      await put(id, [{ category: "food", amount: 12000 }, { category: "fun", amount: 18000 }]);
      const stats = await getMonthlyStats(userId, 2026, 10);
      expect(stats.expense).toBe(30000);
      expect(Object.fromEntries(stats.byCategory.map((c) => [c.category, c.total]))).toEqual({ food: 12000, fun: 18000 });
    });

    it("drop lines when there are fewer, and keep their receipts on the first line", async () => {
      const { id, groupId } = await makeSplit();
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Receipt } = await import("@/models/Receipt");
      await put(id, [{ category: "food", amount: 10000 }, { category: "home", amount: 10000 }, { category: "fun", amount: 10000 }]);
      const rows = await Transaction.find({ splitGroupId: groupId, isDeleted: { $ne: true } }).sort({ _id: 1 }).lean<{ _id: { toString(): string } }[]>();
      expect(rows).toHaveLength(3);
      const { addReceipt } = await import("@/lib/receipt-service");
      const r = await addReceipt({ userId, transactionId: rows[2]._id.toString(), bytes: JPEG });
      const before = await balance();
      const res = await put(id, [{ category: "food", amount: 15000 }, { category: "home", amount: 15000 }]);
      expect(res.status).toBe(200);
      const left = await Transaction.find({ splitGroupId: groupId, isDeleted: { $ne: true } }).sort({ _id: 1 }).lean<{ _id: { toString(): string }; attachments: string[] }[]>();
      expect(left).toHaveLength(2);
      expect(left[0].attachments).toEqual([r.id]);
      expect((await Receipt.findById(r.id).lean<{ transaction: { toString(): string } }>())!.transaction.toString()).toBe(left[0]._id.toString());
      expect(await balance()).toBe(before);
    });

    it("turn a plain expense into a split", async () => {
      const t = await addTxn({ amount: 9000, category: "food" });
      const res = await put(t._id.toString(), [{ category: "food", amount: 4000 }, { category: "fun", amount: 5000 }]);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.splitGroupId).toBeTruthy();
      expect(json.data.lines).toHaveLength(2);
      expect(json.data.lines[0].id).toBe(t._id.toString());
    });

    it("reject lines that do not add up, too few lines and too many", async () => {
      const t = await addTxn({ amount: 9000 });
      expect((await put(t._id.toString(), [{ category: "a", amount: 4000 }, { category: "b", amount: 4000 }])).status).toBe(400);
      expect((await put(t._id.toString(), [{ category: "a", amount: 9000 }])).status).toBe(400);
      const many = Array.from({ length: 21 }, (_, i) => ({ category: `c${i}`, amount: 1 }));
      expect((await put(t._id.toString(), many)).status).toBe(400);
      expect((await put(t._id.toString(), [{ category: "a", amount: 4500.5 }, { category: "b", amount: 4499.5 }])).status).toBe(400);
    });

    it("refuse income, recurring, unreviewed, linked and refunded rows and other users' rows", async () => {
      const lines = [{ category: "a", amount: 4500 }, { category: "b", amount: 4500 }];
      const income = await addTxn({ amount: 9000, type: "income" });
      expect((await put(income._id.toString(), lines)).status).toBe(400);
      const recurring = await addTxn({ amount: 9000, isRecurring: true, recurringId: new mongoose.Types.ObjectId(), installmentStatus: "paid" });
      expect((await put(recurring._id.toString(), lines)).status).toBe(400);
      const unreviewed = await addTxn({ amount: 9000, reviewStatus: "unreviewed" });
      expect((await put(unreviewed._id.toString(), lines)).status).toBe(409);
      const repay = await addTxn({ amount: 9000, tags: ["repayment:x"] });
      expect((await put(repay._id.toString(), lines)).status).toBe(409);
      const refunded = await addTxn({ amount: 9000 });
      await addTxn({ amount: 9000, type: "income", refundOf: refunded._id, refundStatus: "confirmed" });
      expect((await put(refunded._id.toString(), lines)).status).toBe(409);
      const theirs = await addTxn({ amount: 9000 }, otherUserId);
      expect((await put(theirs._id.toString(), lines)).status).toBe(404);
    });

    it("an idempotent retry replays and a retry with other lines conflicts", async () => {
      const { PUT } = await import("@/app/api/integrations/transactions/[id]/splits/route");
      const t = await addTxn({ amount: 9000 });
      const id = t._id.toString();
      const a = [{ category: "a", amount: 4500 }, { category: "b", amount: 4500 }];
      const b = [{ category: "a", amount: 1000 }, { category: "b", amount: 8000 }];
      const first = await PUT(req(`transactions/${id}/splits`, "PUT", { splits: a }, { "idempotency-key": "same-key" }), ctx(id));
      expect(first.status).toBe(200);
      const replay = await PUT(req(`transactions/${id}/splits`, "PUT", { splits: a }, { "idempotency-key": "same-key" }), ctx(id));
      expect(replay.status).toBe(200);
      const other = await PUT(req(`transactions/${id}/splits`, "PUT", { splits: b }, { "idempotency-key": "same-key" }), ctx(id));
      expect(other.status).toBe(409);
    });

    it("GET returns the lines of a split from any line, and the single row of a plain one", async () => {
      const { GET } = await import("@/app/api/integrations/transactions/[id]/splits/route");
      const { id } = await makeSplit();
      const split = await (await GET(req(`transactions/${id}/splits`), ctx(id))).json();
      expect(split.data.lines).toHaveLength(2);
      const plain = await addTxn({ amount: 500 });
      const one = await (await GET(req(`transactions/${plain._id}/splits`), ctx(plain._id.toString()))).json();
      expect(one.data).toMatchObject({ splitGroupId: null, total: 500 });
    });

    it("create caps the lines at 20 and returns the group id", async () => {
      const { transactionCreateSchema } = await import("@/lib/transaction-service");
      const many = Array.from({ length: 21 }, (_, i) => ({ category: `c${i}`, amount: 1 }));
      expect(transactionCreateSchema.safeParse({ accountId, type: "expense", amount: 21, date: "2026-10-05", splits: many }).success).toBe(false);
      const { POST } = await import("@/app/api/integrations/transactions/route");
      const res = await POST(req("transactions", "POST", {
        accountId, type: "expense", amount: 300, date: "2026-10-05", tags: ["Trip"],
        splits: [{ category: "food", amount: 100 }, { category: "fun", amount: 200 }],
      }), undefined as never);
      const json = await res.json();
      expect(res.status).toBe(201);
      expect(json.data.splitGroupId).toBeTruthy();
      expect(json.data.tags).toEqual(["trip"]);
    });
  });

  describe("receipts", () => {
    it("sniffs the type from the bytes, not from a header", async () => {
      const { sniffImageType } = await import("@/lib/receipt-service");
      expect(sniffImageType(JPEG)).toBe("image/jpeg");
      expect(sniffImageType(PNG)).toBe("image/png");
      expect(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP")]))).toBe("image/webp");
      expect(sniffImageType(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic")]))).toBe("image/heic");
      expect(sniffImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
      expect(sniffImageType(Buffer.from("GIF89a-----------"))).toBeNull();
      expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    });

    it("upload stores it encrypted, links it, and the owner reads it back with safe headers", async () => {
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const { GET } = await import("@/app/api/integrations/receipts/[id]/route");
      const t = await addTxn();
      const res = await fetchRoute(t._id.toString(), JPEG, KEY);
      const json = await res.json();
      expect(res.status).toBe(201);
      expect(json.data).toMatchObject({ transactionId: t._id.toString(), contentType: "image/jpeg", size: JPEG.length });

      const stored = await Receipt.findById(json.data.id);
      expect(Buffer.from(stored!.data).includes(Buffer.from("receipt-bytes"))).toBe(false);
      const row = await Transaction.findById(t._id).lean<{ attachments: string[] }>();
      expect(row!.attachments).toEqual([json.data.id]);

      const img = await GET(req(`receipts/${json.data.id}`), ctx(json.data.id));
      expect(img.status).toBe(200);
      expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
      expect(img.headers.get("content-type")).toBe("image/jpeg");
      expect(img.headers.get("cache-control")).toBe("private, no-store");
      expect(img.headers.get("x-content-type-options")).toBe("nosniff");
      expect(img.headers.get("content-security-policy")).toContain("sandbox");
    });

    it("refuse something that is not an image, however it is labelled", async () => {
      const t = await addTxn();
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const res = await POST(req(`transactions/${t._id}/receipts`, "POST", Buffer.from("<script>alert(1)</script>"), { "content-type": "image/jpeg" }), ctx(t._id.toString()));
      expect(res.status).toBe(400);
      expect((await res.json()).error.reason).toBe("UNSUPPORTED_TYPE");
      const empty = await POST(req(`transactions/${t._id}/receipts`, "POST", Buffer.alloc(0)), ctx(t._id.toString()));
      expect(empty.status).toBe(400);
    });

    it("refuse a file over 3 MB, from the header and from the stream", async () => {
      const t = await addTxn();
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const { MAX_RECEIPT_BYTES, readBodyCapped } = await import("@/lib/receipt-service");
      const big = Buffer.concat([JPEG, Buffer.alloc(MAX_RECEIPT_BYTES)]);
      const res = await POST(req(`transactions/${t._id}/receipts`, "POST", big), ctx(t._id.toString()));
      expect(res.status).toBe(400);
      expect((await res.json()).error.reason).toBe("TOO_LARGE");
      const noLength = new Request("http://localhost/x", { method: "POST", body: new Uint8Array(big) });
      expect(await readBodyCapped(noLength, MAX_RECEIPT_BYTES)).toEqual({ ok: false, reason: "too_large" });
      const small = await readBodyCapped(new Request("http://localhost/x", { method: "POST", body: new Uint8Array(JPEG) }), MAX_RECEIPT_BYTES);
      expect(small.ok && small.bytes.equals(JPEG)).toBe(true);
    });

    it("another user can neither read, list, attach to nor delete a receipt", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { GET, DELETE } = await import("@/app/api/integrations/receipts/[id]/route");
      const { GET: LIST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const { default: Receipt } = await import("@/models/Receipt");
      const theirTxn = await addTxn({}, otherUserId);
      const theirs = await addReceipt({ userId: otherUserId, transactionId: theirTxn._id.toString(), bytes: JPEG });
      expect((await GET(req(`receipts/${theirs.id}`), ctx(theirs.id))).status).toBe(404);
      expect((await DELETE(req(`receipts/${theirs.id}`, "DELETE"), ctx(theirs.id))).status).toBe(404);
      expect(await Receipt.countDocuments({ _id: theirs.id })).toBe(1);
      expect((await LIST(req(`transactions/${theirTxn._id}/receipts`), ctx(theirTxn._id.toString()))).status).toBe(404);
      expect((await fetchRoute(theirTxn._id.toString(), JPEG, KEY)).status).toBe(404);
      expect((await GET(req("receipts/not-an-id"), ctx("not-an-id"))).status).toBe(404);
    });

    it("the browser routes need a session and check the owner too", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { GET } = await import("@/app/api/receipts/[id]/route");
      const t = await addTxn();
      const r = await addReceipt({ userId, transactionId: t._id.toString(), bytes: PNG });
      const call = () => GET(new NextRequest(`http://localhost/api/receipts/${r.id}`), ctx(r.id));
      sessionUser.current = null;
      expect((await call()).status).toBe(401);
      sessionUser.current = { id: otherUserId, name: "Other", email: "o@x.com", role: "user" };
      expect((await call()).status).toBe(404);
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      const ok = await call();
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("private, no-store");
      sessionUser.current = null;
    });

    it("a blob moved to another user's record does not decrypt", async () => {
      const { addReceipt, getReceiptImage } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const t = await addTxn();
      const r = await addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG });
      await Receipt.updateOne({ _id: r.id }, { $set: { user: otherUserId } });
      await (await import("@/models/Transaction")).default.updateOne({ _id: t._id }, { $set: { user: otherUserId } });
      await expect(getReceiptImage(otherUserId, r.id)).rejects.toMatchObject({ code: "UNREADABLE" });
    });

    it("hold at most 5 per transaction, even when uploaded together", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn();
      const id = t._id.toString();
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => addReceipt({ userId, transactionId: id, bytes: JPEG })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected.every((r) => r.reason.code === "TOO_MANY")).toBe(true);
      expect(await Receipt.countDocuments({ user: userId })).toBe(5);
      expect((await Transaction.findById(id).lean<{ attachments: string[] }>())!.attachments).toHaveLength(5);
    });

    it("stop at the per-user quota", async () => {
      const { addReceipt, MAX_RECEIPTS_PER_USER } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const t = await addTxn();
      await Receipt.insertMany(
        Array.from({ length: MAX_RECEIPTS_PER_USER }, () => ({
          user: userId, transaction: t._id, contentType: "image/jpeg", size: 10,
          iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
        }))
      );
      await expect(addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    });

    it("deleting a receipt unlinks it, deleting the transaction deletes its receipts for good", async () => {
      const { addReceipt, deleteReceipt } = await import("@/lib/receipt-service");
      const { deleteTransaction } = await import("@/lib/transaction-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 1000 });
      const id = t._id.toString();
      const a = await addReceipt({ userId, transactionId: id, bytes: JPEG });
      await addReceipt({ userId, transactionId: id, bytes: PNG });
      await deleteReceipt(userId, a.id);
      expect((await Transaction.findById(id).lean<{ attachments: string[] }>())!.attachments).toHaveLength(1);
      expect(await Receipt.countDocuments({ transaction: id })).toBe(1);
      await deleteTransaction(userId, id, actor);
      expect(await Receipt.countDocuments({ transaction: id })).toBe(0);
      await expect(addReceipt({ userId, transactionId: id, bytes: JPEG })).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND" });
    });

    it("refuse a receipt on a voided transaction", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const t = await addTxn({ reviewStatus: "voided" });
      await expect(addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG })).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND" });
    });

    it("an idempotent upload retry makes one receipt", async () => {
      const { default: Receipt } = await import("@/models/Receipt");
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const t = await addTxn();
      const send = () => POST(req(`transactions/${t._id}/receipts`, "POST", JPEG, { "idempotency-key": "up-1" }), ctx(t._id.toString()));
      const a = await send();
      const b = await send();
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(await Receipt.countDocuments({ user: userId })).toBe(1);
    });

    it("write routes need an Idempotency-Key", async () => {
      const t = await addTxn();
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const r = new NextRequest(`http://localhost/api/integrations/transactions/${t._id}/receipts`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}` },
        body: new Uint8Array(JPEG),
      });
      expect((await POST(r, ctx(t._id.toString()))).status).toBe(400);
    });
  });

  describe("review fixes: descriptions, concurrent edits, limits, privacy", () => {
    const putSplits = async (id: string, splits: unknown, headers: Record<string, string> = {}) => {
      const { PUT } = await import("@/app/api/integrations/transactions/[id]/splits/route");
      return PUT(req(`transactions/${id}/splits`, "PUT", { splits }, headers), ctx(id));
    };
    async function splitOf(descriptions: (string | undefined)[], shared = "Mart") {
      const { createTransaction } = await import("@/lib/transaction-service");
      const each = 1000;
      const r = await createTransaction({
        userId, actor, accountId, type: "expense", amount: each * descriptions.length, currency: "INR", description: shared,
        date: "2026-10-05T10:00:00.000Z", tags: [], isRecurring: false,
        splits: descriptions.map((d, i) => ({ category: `c${i}`, amount: each, ...(d ? { description: d } : {}) })),
      });
      if (r.kind !== "split") throw new Error("not a split");
      return { id: (r.transaction as { _id: { toString(): string } })._id.toString(), groupId: r.splitGroupId };
    }
    const live = async (groupId: string) => {
      const { default: Transaction } = await import("@/models/Transaction");
      return Transaction.find({ splitGroupId: groupId, isDeleted: { $ne: true } }).sort({ _id: 1 }).lean<{ _id: { toString(): string }; amount: number; description?: string; tags?: string[]; attachments?: string[] }[]>();
    };

    it("an edit that leaves out a description keeps each line's own, and new lines get the shared one", async () => {
      const { id, groupId } = await splitOf([undefined, "soap"], "Mart");
      const res = await putSplits(id, [
        { category: "food", amount: 700 },
        { category: "home", amount: 700 },
        { category: "fun", amount: 600 },
      ]);
      expect(res.status).toBe(200);
      expect((await live(groupId)).map((r) => r.description)).toEqual(["Mart", "soap", "Mart"]);
      const set = await putSplits(id, [
        { category: "food", amount: 700, description: "bread" },
        { category: "home", amount: 700 },
        { category: "fun", amount: 600 },
      ]);
      expect(set.status).toBe(200);
      expect((await live(groupId)).map((r) => r.description)).toEqual(["bread", "soap", "Mart"]);
    });

    it("two edits at once apply one after the other and the lines always add up", async () => {
      const { id, groupId } = await splitOf(["a", "b"]);
      const mk = (cats: string[]) => cats.map((c) => ({ category: c, amount: 2000 / cats.length }));
      const [r1, r2] = await Promise.all([
        putSplits(id, mk(["x", "y"])),
        putSplits(id, mk(["p", "q", "r", "s"])),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      const rows = await live(groupId);
      expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(2000);
      expect([2, 4]).toContain(rows.length);
      // Exactly one of the two edits is what is left, never a mix.
      expect(rows.map((r) => r.amount)).toEqual(rows.length === 2 ? [1000, 1000] : [500, 500, 500, 500]);
    });

    it("refuses to merge lines when their receipts would not fit on the first line, and changes nothing", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { id, groupId } = await splitOf(["a", "b", "c"]);
      const rows = await live(groupId);
      for (let i = 0; i < 3; i++) await addReceipt({ userId, transactionId: rows[0]._id.toString(), bytes: JPEG });
      for (let i = 0; i < 3; i++) await addReceipt({ userId, transactionId: rows[2]._id.toString(), bytes: JPEG });
      const res = await putSplits(id, [{ category: "x", amount: 1500 }, { category: "y", amount: 1500 }]);
      expect(res.status).toBe(409);
      const after = await live(groupId);
      expect(after).toHaveLength(3);
      expect(after.map((r) => r.amount)).toEqual([1000, 1000, 1000]);
      expect(after[0].attachments).toHaveLength(3);
      expect(after[2].attachments).toHaveLength(3);
    });

    it("will not split a loan row, and never copies link tags onto new lines", async () => {
      const loanRow = await addTxn({ amount: 4000, tags: ["loan:abc", "loan_principal"] });
      const loanLines = [{ category: "a", amount: 2000 }, { category: "b", amount: 2000 }];
      expect((await putSplits(loanRow._id.toString(), loanLines)).status).toBe(409);
      const plain = await addTxn({ amount: 4000, tags: ["trip", "credit_statement:s1"] });
      const res = await putSplits(plain._id.toString(), loanLines);
      expect(res.status).toBe(200);
      const { default: Transaction } = await import("@/models/Transaction");
      const rows = await Transaction.find({ splitGroupId: (await res.json()).data.splitGroupId }).sort({ _id: 1 }).lean<{ tags: string[] }[]>();
      expect(rows[0].tags).toEqual(["trip", "credit_statement:s1"]);
      expect(rows[1].tags).toEqual(["trip"]);
    });

    it("uploads at the same moment never take the user over the receipt quota", async () => {
      const { addReceipt, MAX_RECEIPTS_PER_USER } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const txns = await Promise.all([addTxn(), addTxn(), addTxn()]);
      await Receipt.insertMany(
        Array.from({ length: MAX_RECEIPTS_PER_USER - 2 }, () => ({
          user: userId, transaction: txns[0]._id, contentType: "image/jpeg", size: 10,
          iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
        }))
      );
      const results = await Promise.allSettled(
        Array.from({ length: 9 }, (_, i) => addReceipt({ userId, transactionId: txns[i % 3]._id.toString(), bytes: JPEG }))
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      expect(ok).toBeLessThanOrEqual(2);
      expect(await Receipt.countDocuments({ user: userId })).toBeLessThanOrEqual(MAX_RECEIPTS_PER_USER);
      for (const r of results) if (r.status === "rejected") expect(r.reason.code).toBe("QUOTA_EXCEEDED");
    });

    it("a receipt cannot be read once its transaction is deleted or voided", async () => {
      const { addReceipt, getReceiptImage } = await import("@/lib/receipt-service");
      const { default: Transaction } = await import("@/models/Transaction");
      const a = await addTxn();
      const b = await addTxn();
      const ra = await addReceipt({ userId, transactionId: a._id.toString(), bytes: JPEG });
      const rb = await addReceipt({ userId, transactionId: b._id.toString(), bytes: JPEG });
      await expect(getReceiptImage(userId, ra.id)).resolves.toBeTruthy();
      await Transaction.updateOne({ _id: a._id }, { $set: { isDeleted: true } });
      await Transaction.updateOne({ _id: b._id }, { $set: { reviewStatus: "voided" } });
      await expect(getReceiptImage(userId, ra.id)).rejects.toMatchObject({ code: "RECEIPT_NOT_FOUND" });
      await expect(getReceiptImage(userId, rb.id)).rejects.toMatchObject({ code: "RECEIPT_NOT_FOUND" });
    });

    it("deleting a transaction retries a failed receipt clean-up once; if it still fails the delete stands, the receipt is hidden and a later sweep removes it", async () => {
      const { vi } = await import("vitest");
      const { addReceipt, getReceiptImage } = await import("@/lib/receipt-service");
      const { deleteTransaction } = await import("@/lib/transaction-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 1000 });
      await addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG });

      const once = vi.spyOn(Receipt, "deleteMany").mockRejectedValueOnce(new Error("boom"));
      await deleteTransaction(userId, t._id.toString(), actor);
      once.mockRestore();
      expect(await Receipt.countDocuments({ transaction: t._id })).toBe(0);

      const t2 = await addTxn({ amount: 1000 });
      const r2 = await addReceipt({ userId, transactionId: t2._id.toString(), bytes: JPEG });
      const always = vi.spyOn(Receipt, "deleteMany").mockRejectedValue(new Error("boom"));
      await expect(deleteTransaction(userId, t2._id.toString(), actor)).resolves.toBeTruthy();
      always.mockRestore();
      expect((await Transaction.findById(t2._id).lean<{ isDeleted?: boolean }>())!.isDeleted).toBe(true);
      expect(await Receipt.countDocuments({ transaction: t2._id })).toBe(1);
      await expect(getReceiptImage(userId, r2.id)).rejects.toMatchObject({ code: "RECEIPT_NOT_FOUND" });

      // The next upload sweeps it (and it never counted against the quota).
      const t3 = await addTxn();
      await addReceipt({ userId, transactionId: t3._id.toString(), bytes: JPEG });
      expect(await Receipt.countDocuments({ transaction: t2._id })).toBe(0);
    });

    it("a failure while reversing the balance leaves the receipts alone", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { deleteTransaction } = await import("@/lib/transaction-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 1000 });
      await addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG });
      const spy = vi.spyOn(Account, "findOneAndUpdate").mockRejectedValueOnce(new Error("boom"));
      await expect(deleteTransaction(userId, t._id.toString(), actor)).rejects.toThrow("boom");
      spy.mockRestore();
      expect(await Receipt.countDocuments({ transaction: t._id })).toBe(1);
      expect((await Transaction.findById(t._id).lean<{ isDeleted?: boolean }>())!.isDeleted).toBeFalsy();
    });

    it("deleting a loan removes receipts of its rows after they are deleted, and a failed balance step leaves them", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { deleteLoan } = await import("@/lib/loan-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Loan } = await import("@/models/Loan");
      const { default: Account } = await import("@/models/Account");
      const loan = await Loan.create({ user: userId, direction: "given", counterparty: "Ravi", principalAmount: 5000, remainingAmount: 5000, startDate: new Date() });
      const row = await addTxn({ amount: 5000, tags: [`loan:${loan._id}`, "loan_principal"] });
      await addReceipt({ userId, transactionId: row._id.toString(), bytes: JPEG });
      const spy = vi.spyOn(Account, "findOneAndUpdate").mockRejectedValueOnce(new Error("boom"));
      await expect(deleteLoan(userId, loan._id.toString(), actor)).rejects.toThrow("boom");
      spy.mockRestore();
      expect(await Receipt.countDocuments({ transaction: row._id })).toBe(1);
      await deleteLoan(userId, loan._id.toString(), actor);
      expect(await Receipt.countDocuments({ transaction: row._id })).toBe(0);
    });

    it("cancelling a series removes receipts of its installments after they are deleted, and a failed delete leaves them", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { createTransaction } = await import("@/lib/transaction-service");
      const { cancelRecurringSeries } = await import("@/lib/recurring-series");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      await createTransaction({
        userId, actor, accountId, type: "expense", amount: 2000, currency: "INR", category: "Rent", tags: [],
        isRecurring: true, recurrenceFrequency: "monthly", recurrenceCount: 3, date: new Date(Date.now() + 86400000).toISOString(),
      });
      const rows = await Transaction.find({ user: userId, recurringId: { $exists: true } }).lean<{ _id: { toString(): string }; recurringId: unknown }[]>();
      await addReceipt({ userId, transactionId: rows[0]._id.toString(), bytes: JPEG });
      const seriesId = String(rows[0].recurringId);
      const spy = vi.spyOn(Transaction, "updateMany").mockRejectedValueOnce(new Error("boom"));
      await expect(cancelRecurringSeries(userId, seriesId, actor)).rejects.toThrow("boom");
      spy.mockRestore();
      expect(await Receipt.countDocuments({ user: userId })).toBe(1);
      await cancelRecurringSeries(userId, seriesId, actor);
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
    });

    it("a split edit that fails part way is rolled back, and a retry then works", async () => {
      const { vi } = await import("vitest");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 9000, category: "food", description: "Mart" });
      const id = t._id.toString();
      const lines = [{ category: "a", amount: 3000 }, { category: "b", amount: 3000 }, { category: "c", amount: 3000 }];
      const spy = vi.spyOn(Transaction, "insertMany").mockRejectedValueOnce(new Error("boom"));
      await expect((await import("@/lib/split-service")).replaceSplits({ userId, transactionId: id, splits: lines, actor })).rejects.toThrow("boom");
      spy.mockRestore();
      const rows = await Transaction.find({ user: userId, isDeleted: { $ne: true } }).lean<{ category: string; amount: number; splitGroupId?: unknown; description?: string }[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: "food", amount: 9000, description: "Mart" });
      expect(rows[0].splitGroupId).toBeUndefined();
      expect((await putSplits(id, lines)).status).toBe(200);
    });

    it("a failure while merging lines puts the lines and their receipts back", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Receipt } = await import("@/models/Receipt");
      const { id, groupId } = await splitOf(["a", "b", "c"]);
      const before = await live(groupId);
      const r = await addReceipt({ userId, transactionId: before[2]._id.toString(), bytes: JPEG });
      const spy = vi.spyOn(Receipt, "updateMany").mockRejectedValueOnce(new Error("boom"));
      const merged = [{ category: "x", amount: 1500 }, { category: "y", amount: 1500 }];
      await expect((await import("@/lib/split-service")).replaceSplits({ userId, transactionId: id, splits: merged, actor })).rejects.toThrow("boom");
      spy.mockRestore();
      const after = await live(groupId);
      expect(after.map((x) => [x._id.toString(), x.amount])).toEqual(before.map((x) => [x._id.toString(), x.amount]));
      expect(after[0].attachments ?? []).toEqual([]);
      expect(after[2].attachments).toEqual([r.id]);
      expect((await Receipt.findById(r.id).lean<{ transaction: { toString(): string } }>())!.transaction.toString()).toBe(before[2]._id.toString());
      expect((await putSplits(id, merged)).status).toBe(200);
      expect((await Transaction.findById(before[0]._id).lean<{ attachments: string[] }>())!.attachments).toEqual([r.id]);
    });

    it("a receipt whose link step fails is taken back out", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn();
      const spy = vi.spyOn(Transaction, "updateOne").mockRejectedValueOnce(new Error("boom"));
      await expect(addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG })).rejects.toThrow("boom");
      spy.mockRestore();
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
    });

    it("the list shows only what the transaction lists; a failed delete after the unlink leaves nothing reachable and a stray old receipt is swept", async () => {
      const { vi } = await import("vitest");
      const { addReceipt, deleteReceipt, listReceipts } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const t = await addTxn();
      const id = t._id.toString();
      const kept = await addReceipt({ userId, transactionId: id, bytes: JPEG });
      const gone = await addReceipt({ userId, transactionId: id, bytes: PNG });
      const spy = vi.spyOn(Receipt, "deleteOne").mockRejectedValueOnce(new Error("boom"));
      await expect(deleteReceipt(userId, gone.id)).rejects.toThrow("boom");
      spy.mockRestore();
      expect((await listReceipts(userId, id)).map((r) => r.id)).toEqual([kept.id]);
      await Receipt.collection.updateOne({ _id: new mongoose.Types.ObjectId(gone.id) }, { $set: { createdAt: new Date(Date.now() - 3600_000) } });
      await listReceipts(userId, id);
      expect(await Receipt.countDocuments({ _id: gone.id })).toBe(0);
    });

    it("the tag filter matches a tag with inner double spaces the way it was stored", async () => {
      const { GET } = await import("@/app/api/integrations/transactions/route");
      const { transactionCreateSchema } = await import("@/lib/transaction-service");
      const parsed = transactionCreateSchema.parse({ accountId, type: "expense", amount: 100, category: "food", date: "2026-10-05", tags: ["Work   Lunch"] });
      await addTxn({ tags: parsed.tags });
      const list = await (await GET(req("transactions?tag=WORK%20%20%20lunch"), undefined as never)).json();
      expect(list.data.total).toBe(1);
    });

    it("a clone insert that half-works and then fails leaves no clones behind", async () => {
      const { vi } = await import("vitest");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 9000, category: "food" });
      const real = Transaction.insertMany.bind(Transaction);
      const spy = vi.spyOn(Transaction, "insertMany").mockImplementationOnce((async (...args: unknown[]) => {
        await (real as (...a: unknown[]) => Promise<unknown>)(...args);
        throw new Error("boom");
      }) as never);
      const lines = [{ category: "a", amount: 3000 }, { category: "b", amount: 3000 }, { category: "c", amount: 3000 }];
      await expect((await import("@/lib/split-service")).replaceSplits({ userId, transactionId: t._id.toString(), splits: lines, actor })).rejects.toThrow("boom");
      spy.mockRestore();
      const rows = await Transaction.find({ user: userId }).lean<{ category: string; amount: number; splitGroupId?: unknown }[]>();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: "food", amount: 9000 });
      expect(rows[0].splitGroupId).toBeUndefined();
    });

    it("a split edit writes its ledger blocks once, after it commits, and none when it fails", async () => {
      const { vi } = await import("vitest");
      const { default: LedgerBlock } = await import("@/models/LedgerBlock");
      const { default: Transaction } = await import("@/models/Transaction");
      const t = await addTxn({ amount: 9000 });
      const lines = [{ category: "a", amount: 4000 }, { category: "b", amount: 5000 }];
      const spy = vi.spyOn(Transaction, "insertMany").mockRejectedValueOnce(new Error("boom"));
      await expect((await import("@/lib/split-service")).replaceSplits({ userId, transactionId: t._id.toString(), splits: lines, actor })).rejects.toThrow("boom");
      spy.mockRestore();
      expect(await LedgerBlock.countDocuments({ user: userId })).toBe(0);
      expect((await putSplits(t._id.toString(), lines)).status).toBe(200);
      expect(await LedgerBlock.countDocuments({ user: userId, scope: "transaction" })).toBe(2);
    });

    it("the sweep leaves a receipt that was moved to another line while it was deciding", async () => {
      const { vi } = await import("vitest");
      const { sweepOrphanReceipts } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const from = await addTxn();
      const to = await addTxn();
      const old = new Date(Date.now() - 3600_000);
      const r = await Receipt.create({
        user: userId, transaction: from._id, contentType: "image/jpeg", size: 10,
        iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
      });
      await Receipt.collection.updateOne({ _id: r._id }, { $set: { createdAt: old } });
      // Old and not listed: an orphan. Just before it is deleted, a split edit moves it.
      const realDelete = Receipt.deleteOne.bind(Receipt);
      const spy = vi.spyOn(Receipt, "deleteOne").mockImplementationOnce(((filter: unknown) => {
        return (async () => {
          await Receipt.collection.updateOne({ _id: r._id }, { $set: { transaction: to._id } });
          return (realDelete as (f: unknown) => Promise<unknown>)(filter);
        })();
      }) as never);
      await sweepOrphanReceipts(userId);
      spy.mockRestore();
      expect(await Receipt.countDocuments({ _id: r._id, transaction: to._id })).toBe(1);
    });

    it("the sweep keeps a fresh unlinked receipt for 10 minutes and removes it after", async () => {
      const { sweepOrphanReceipts } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const t = await addTxn();
      const mk = async (ageMs: number) => {
        const r = await Receipt.create({
          user: userId, transaction: t._id, contentType: "image/jpeg", size: 10,
          iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
        });
        await Receipt.collection.updateOne({ _id: r._id }, { $set: { createdAt: new Date(Date.now() - ageMs) } });
        return r._id;
      };
      const fresh = await mk(60_000);
      const stale = await mk(11 * 60_000);
      expect(await sweepOrphanReceipts(userId)).toBe(1);
      expect(await Receipt.countDocuments({ _id: fresh })).toBe(1);
      expect(await Receipt.countDocuments({ _id: stale })).toBe(0);
    });

    it("self-delete purges receipts before the account is locked, and fails without locking if it cannot", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: User } = await import("@/models/User");
      const { DELETE } = await import("@/app/api/me/route");
      const t = await addTxn();
      await addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG });
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };

      const fail = vi.spyOn(Receipt, "deleteMany").mockRejectedValue(new Error("boom"));
      expect((await DELETE()).status).toBe(500);
      fail.mockRestore();
      expect((await User.findById(userId).lean<{ isActive: boolean }>())!.isActive).toBe(true);
      expect(await Receipt.countDocuments({ user: userId })).toBe(1);

      // The first purge works, the final one keeps failing: still deleted, only logged.
      const real = Receipt.deleteMany.bind(Receipt);
      let calls = 0;
      const flaky = vi.spyOn(Receipt, "deleteMany").mockImplementation(((...a: unknown[]) => {
        calls += 1;
        return calls === 1 ? (real as (...x: unknown[]) => unknown)(...a) : Promise.reject(new Error("boom"));
      }) as never);
      expect((await DELETE()).status).toBe(200);
      flaky.mockRestore();
      sessionUser.current = null;
      expect((await User.findById(userId).lean<{ isActive: boolean }>())!.isActive).toBe(false);
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
    });

    it("a transient transaction error is retried: the ledger and the budget alert come out once", async () => {
      const { vi } = await import("vitest");
      const { MongoServerError } = await import("mongodb");
      const { default: LedgerBlock } = await import("@/models/LedgerBlock");
      const { default: Transaction } = await import("@/models/Transaction");
      const alert = await import("@/lib/budget-alert");
      const alertSpy = vi.spyOn(alert, "checkBudgetAlert").mockResolvedValue(undefined as never);
      const t = await addTxn({ amount: 9000, category: "food" });
      const transient = new MongoServerError({ message: "write conflict", errorLabels: ["TransientTransactionError"] });
      const spy = vi.spyOn(Transaction, "findOneAndUpdate").mockImplementationOnce((() => ({ lean: () => Promise.reject(transient) })) as never);
      const res = await putSplits(t._id.toString(), [{ category: "a", amount: 4000 }, { category: "b", amount: 5000 }]);
      spy.mockRestore();
      expect(res.status).toBe(200);
      // One update (the first line) and one create (the second): not doubled by the retry.
      expect(await LedgerBlock.countDocuments({ user: userId, scope: "transaction" })).toBe(2);
      expect(alertSpy).toHaveBeenCalledTimes(2);
      alertSpy.mockRestore();
      expect(await Transaction.countDocuments({ user: userId })).toBe(2);
    });

    it("a receipt that vanished mid-move aborts the edit with a 409 that is not stored under the key", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { PUT } = await import("@/app/api/transactions/[id]/splits/route");
      const { id, groupId } = await splitOf(["a", "b", "c"]);
      const rows = await live(groupId);
      await addReceipt({ userId, transactionId: rows[2]._id.toString(), bytes: JPEG });
      const merged = [{ category: "x", amount: 1500 }, { category: "y", amount: 1500 }];
      const spy = vi.spyOn(Receipt, "updateMany").mockResolvedValueOnce({ matchedCount: 0 } as never);
      const first = await putSplits(id, merged, { "idempotency-key": "busy-key" });
      expect(first.status).toBe(409);
      expect((await first.json()).error.code).toBe("CONFLICT");
      expect(await live(groupId)).toHaveLength(3);
      spy.mockRestore();
      const again = await putSplits(id, merged, { "idempotency-key": "busy-key" });
      expect(again.status).toBe(200);

      const { id: id2, groupId: g2 } = await splitOf(["a", "b", "c"]);
      const rows2 = await live(g2);
      await addReceipt({ userId, transactionId: rows2[2]._id.toString(), bytes: JPEG });
      const spy2 = vi.spyOn(Receipt, "updateMany").mockResolvedValueOnce({ matchedCount: 0 } as never);
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      const web = await PUT(new NextRequest(`http://localhost/api/transactions/${id2}/splits`, { method: "PUT", body: JSON.stringify({ splits: merged }), headers: { "content-type": "application/json" } }), ctx(id2));
      sessionUser.current = null;
      spy2.mockRestore();
      expect(web.status).toBe(409);
    });

    it("an upload that lands after the account was locked is taken back out", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: User } = await import("@/models/User");
      const t = await addTxn();
      await User.updateOne({ _id: userId }, { $set: { isActive: false } });
      await expect(addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG })).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND" });
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
    });

    it("the final purge on self-delete removes a receipt added between the two purges", async () => {
      const { vi } = await import("vitest");
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { DELETE } = await import("@/app/api/me/route");
      const t = await addTxn();
      await addReceipt({ userId, transactionId: t._id.toString(), bytes: JPEG });
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      const real = Receipt.deleteMany.bind(Receipt);
      let calls = 0;
      const spy = vi.spyOn(Receipt, "deleteMany").mockImplementation(((...a: unknown[]) => {
        calls += 1;
        if (calls !== 2) return (real as (...x: unknown[]) => unknown)(...a);
        // Between the first purge and the last one, a request that was already running lands a receipt.
        return (async () => {
          await Receipt.create({
            user: userId, transaction: t._id, contentType: "image/png", size: 10,
            iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
          });
          return (real as (...x: unknown[]) => unknown)(...a);
        })();
      }) as never);
      const res = await DELETE();
      spy.mockRestore();
      sessionUser.current = null;
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
    });

    it("an imported file cannot write link tags, and its other tags are cleaned", async () => {
      const { commitImport } = await import("@/lib/transaction-import");
      const { default: Transaction } = await import("@/models/Transaction");
      const csv = ["Date,Narration,Amount,Tags", '01/10/2026,Coffee,-120.00,"Trip;repayment:abc;loan_principal;credit_statement:x;  Work   Lunch "'].join("\n");
      const res = await commitImport(userId, actor, { accountId, csv, dateOrder: "dmy", amountSign: "signed", includeDuplicates: false, adjustBalance: false });
      expect(res.imported).toBe(1);
      const row = await Transaction.findOne({ user: userId, source: "import" }).lean<{ tags: string[] }>();
      expect(row!.tags).toEqual(["trip", "work lunch"]);
    });

    it("a foreign-currency row cannot be split", async () => {
      const t = await addTxn({ amount: 8300, originalAmount: 100, originalCurrency: "USD", originalExponent: 2, rate: 83 });
      const res = await putSplits(t._id.toString(), [{ category: "a", amount: 4000 }, { category: "b", amount: 4300 }]);
      expect(res.status).toBe(400);
    });

    it("tags with a comma or a pipe survive an export and re-import", async () => {
      const { commitImport } = await import("@/lib/transaction-import");
      const { GET } = await import("@/app/api/integrations/export/transactions/route");
      const { default: Transaction } = await import("@/models/Transaction");
      await addTxn({ amount: 12000, tags: ["food, cafe", "a|b", "plain"], date: new Date(2026, 9, 5, 12) });
      const out = await GET(req("export/transactions"), {});
      const csv = await out.text();
      expect(csv).toContain("food, cafe;a|b;plain");
      await Transaction.deleteMany({ user: userId });
      const res = await commitImport(userId, actor, { accountId, csv, dateOrder: "ymd", amountSign: "expense", includeDuplicates: false, adjustBalance: false });
      expect(res.imported).toBe(1);
      const row = await Transaction.findOne({ user: userId, source: "import" }).lean<{ tags: string[] }>();
      expect(row!.tags).toEqual(["food, cafe", "a|b", "plain"]);
    });

    it("a tag cannot contain a semicolon (the export's separator)", async () => {
      const { transactionCreateSchema } = await import("@/lib/transaction-service");
      expect(transactionCreateSchema.safeParse({ accountId, type: "expense", amount: 100, category: "food", date: "2026-10-05", tags: ["a;b"] }).success).toBe(false);
    });

    it("a split made by an import leaves the balance alone and raises no alerts", async () => {
      const { vi } = await import("vitest");
      const { createTransaction } = await import("@/lib/transaction-service");
      const alert = await import("@/lib/budget-alert");
      const spy = vi.spyOn(alert, "checkBudgetAlert").mockResolvedValue(undefined as never);
      const base = {
        userId, actor, accountId, type: "expense" as const, amount: 3000, currency: "INR", tags: [], isRecurring: false,
        date: "2026-10-05T10:00:00.000Z", splits: [{ category: "a", amount: 1000 }, { category: "b", amount: 2000 }],
      };
      const before = await balance();
      await createTransaction({ ...base, provenance: { source: "import" }, skipBalance: true });
      expect(await balance()).toBe(before);
      expect(spy).not.toHaveBeenCalled();
      await createTransaction(base);
      expect(await balance()).toBe(before - 3000);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });

    // A body that sends its first bytes and then goes quiet, and records whether it was ever read.
    function stalledBody() {
      const state = { pulled: 0 };
      // highWaterMark 0: nothing is pulled until someone reads, so `pulled` counts real reads.
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            state.pulled += 1;
            return new Promise<void>(() => undefined);
          },
        },
        { highWaterMark: 0 }
      );
      return { state, stream };
    }
    const stalledRequest = (stream: ReadableStream<Uint8Array>, key: string, id: string) =>
      new NextRequest(`http://localhost/api/integrations/transactions/${id}/receipts`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "idempotency-key": key },
        body: stream,
        duplex: "half",
      } as never);

    it("a body that goes quiet is given up on after the idle wait, and the slot is free again", async () => {
      const { readReceiptBody, RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      const saved = { ...RECEIPT_READ_LIMITS };
      RECEIPT_READ_LIMITS.idleMs = 40;
      try {
        const { stream } = stalledBody();
        const started = Date.now();
        const res = await readReceiptBody(new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as never), userId, 1000);
        expect(res).toEqual({ ok: false, reason: "timeout" });
        expect(Date.now() - started).toBeLessThan(2000);
        const ok = await readReceiptBody(new Request("http://localhost/x", { method: "POST", body: new Uint8Array(JPEG) }), userId, 1000);
        expect(ok.ok).toBe(true);
      } finally {
        Object.assign(RECEIPT_READ_LIMITS, saved);
      }
    });

    it("a slow trickle is stopped by the total deadline", async () => {
      const { readReceiptBody, RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      const saved = { ...RECEIPT_READ_LIMITS };
      RECEIPT_READ_LIMITS.idleMs = 1000;
      RECEIPT_READ_LIMITS.totalMs = 120;
      RECEIPT_READ_LIMITS.minBytesPerSec = 0;
      try {
        const stream = new ReadableStream<Uint8Array>({
          async pull(c) {
            await new Promise((r) => setTimeout(r, 30));
            c.enqueue(new Uint8Array([1]));
          },
        });
        const res = await readReceiptBody(new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as never), userId, 1_000_000);
        expect(res).toEqual({ ok: false, reason: "timeout" });
      } finally {
        Object.assign(RECEIPT_READ_LIMITS, saved);
      }
    });

    it("one person reads one body at a time, and the process reads at most sixteen", async () => {
      const { readReceiptBody, RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      const saved = { ...RECEIPT_READ_LIMITS };
      RECEIPT_READ_LIMITS.idleMs = 250;
      try {
        const slow = (u: string) => readReceiptBody(new Request("http://localhost/x", { method: "POST", body: stalledBody().stream, duplex: "half" } as never), u, 1000);
        const fast = (u: string) => readReceiptBody(new Request("http://localhost/x", { method: "POST", body: new Uint8Array(JPEG) }), u, 1000);
        const first = slow("u1");
        expect(await fast("u1")).toEqual({ ok: false, reason: "busy" });
        const others = Array.from({ length: 15 }, (_, i) => slow(`u${i + 2}`));
        expect(await fast("u99")).toEqual({ ok: false, reason: "busy" });
        await Promise.all([first, ...others]);
        expect((await fast("u99")).ok).toBe(true);
      } finally {
        Object.assign(RECEIPT_READ_LIMITS, saved);
      }
    });

    it("a trickle that stays under the minimum speed is dropped after the grace, long before the total", async () => {
      const { readReceiptBody, RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      const saved = { ...RECEIPT_READ_LIMITS };
      RECEIPT_READ_LIMITS.graceMs = 60;
      RECEIPT_READ_LIMITS.totalMs = 20_000;
      RECEIPT_READ_LIMITS.idleMs = 5_000;
      try {
        // A byte every 20 ms is 50 bytes a second: well under 20 KB/s, and no gap is long enough for the idle wait.
        const trickle = new ReadableStream<Uint8Array>({
          async pull(c) {
            await new Promise((r) => setTimeout(r, 20));
            c.enqueue(new Uint8Array([1]));
          },
        }, { highWaterMark: 0 });
        const started = Date.now();
        const res = await readReceiptBody(new Request("http://localhost/x", { method: "POST", body: trickle, duplex: "half" } as never), userId, 1_000_000);
        expect(res).toEqual({ ok: false, reason: "timeout" });
        expect(Date.now() - started).toBeLessThan(2000);

        // A sender at a fair speed is not dropped, even after the grace.
        const body = Buffer.alloc(200_000, 1);
        const fair = new ReadableStream<Uint8Array>({
          async pull(c) {
            await new Promise((r) => setTimeout(r, 20));
            const sent = (fair as unknown as { sent?: number }).sent ?? 0;
            c.enqueue(new Uint8Array(body.subarray(sent, sent + 50_000)));
            (fair as unknown as { sent?: number }).sent = sent + 50_000;
            if (sent + 50_000 >= body.length) c.close();
          },
        }, { highWaterMark: 0 });
        const ok = await readReceiptBody(new Request("http://localhost/x", { method: "POST", body: fair, duplex: "half" } as never), userId, 1_000_000);
        expect(ok.ok && ok.bytes.length).toBe(200_000);
      } finally {
        Object.assign(RECEIPT_READ_LIMITS, saved);
      }
    });

    it("the receipt read limits are 16 reads, 30 s in total, 10 s idle, 20 KB/s after a 3 s grace", async () => {
      const { RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      expect(RECEIPT_READ_LIMITS).toEqual({ totalMs: 30_000, idleMs: 10_000, graceMs: 3_000, minBytesPerSec: 20 * 1024 });
    });

    it("a refused upload is refused before its body is read", async () => {
      const { addReceipt, MAX_RECEIPTS_PER_USER } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const t = await addTxn();
      const id = t._id.toString();

      // No such transaction.
      let b = stalledBody();
      const missing = await POST(stalledRequest(b.stream, "pre-1", new mongoose.Types.ObjectId().toString()), ctx(new mongoose.Types.ObjectId().toString()));
      expect(missing.status).toBe(404);
      expect(b.state.pulled).toBe(0);

      // Quota full.
      await Receipt.insertMany(
        Array.from({ length: MAX_RECEIPTS_PER_USER }, () => ({
          user: userId, transaction: t._id, contentType: "image/jpeg", size: 10,
          iv: Buffer.alloc(12), tag: Buffer.alloc(16), data: Buffer.alloc(10),
        }))
      );
      b = stalledBody();
      const full = await POST(stalledRequest(b.stream, "pre-2", id), ctx(id));
      expect(full.status).toBe(409);
      expect((await full.json()).error.reason).toBe("QUOTA_EXCEEDED");
      expect(b.state.pulled).toBe(0);
      await Receipt.deleteMany({ user: userId });

      // Five already on the transaction.
      for (let i = 0; i < 5; i++) await addReceipt({ userId, transactionId: id, bytes: JPEG });
      b = stalledBody();
      const five = await POST(stalledRequest(b.stream, "pre-3", id), ctx(id));
      expect(five.status).toBe(409);
      expect((await five.json()).error.reason).toBe("TOO_MANY");
      expect(b.state.pulled).toBe(0);
    });

    it("a retry of an upload that worked still gets its stored answer when the transaction is now full", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { POST } = await import("@/app/api/integrations/transactions/[id]/receipts/route");
      const t = await addTxn();
      const id = t._id.toString();
      for (let i = 0; i < 4; i++) await addReceipt({ userId, transactionId: id, bytes: PNG });
      const send = () => POST(req(`transactions/${id}/receipts`, "POST", JPEG, { "idempotency-key": "fifth" }), ctx(id));
      const first = await send();
      expect(first.status).toBe(201);
      const again = await send();
      expect(again.status).toBe(201);
    });

    it("the browser route answers 429 when another upload of the same person is still arriving, and 413 or 408 for the rest", async () => {
      const { readReceiptBody, RECEIPT_READ_LIMITS } = await import("@/lib/receipt-service");
      const { POST } = await import("@/app/api/transactions/[id]/receipts/route");
      const t = await addTxn();
      const id = t._id.toString();
      const saved = { ...RECEIPT_READ_LIMITS };
      RECEIPT_READ_LIMITS.idleMs = 200;
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      try {
        const hold = readReceiptBody(new Request("http://localhost/x", { method: "POST", body: stalledBody().stream, duplex: "half" } as never), userId, 1000);
        const busy = await POST(new NextRequest(`http://localhost/api/transactions/${id}/receipts`, { method: "POST", body: new Uint8Array(JPEG) }), ctx(id));
        expect(busy.status).toBe(429);
        await hold;
        const slow = await POST(new NextRequest(`http://localhost/api/transactions/${id}/receipts`, { method: "POST", body: stalledBody().stream, duplex: "half" } as never), ctx(id));
        expect(slow.status).toBe(408);
      } finally {
        sessionUser.current = null;
        Object.assign(RECEIPT_READ_LIMITS, saved);
      }
    });

    it("the browser split route answers 400 to a body that is not JSON", async () => {
      const { PUT } = await import("@/app/api/transactions/[id]/splits/route");
      const t = await addTxn();
      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      const res = await PUT(new NextRequest(`http://localhost/api/transactions/${t._id}/splits`, { method: "PUT", body: "{nope" }), ctx(t._id.toString()));
      sessionUser.current = null;
      expect(res.status).toBe(400);
    });

    it("deleting the account purges the user's receipts, and the export lists receipt metadata only", async () => {
      const { addReceipt } = await import("@/lib/receipt-service");
      const { default: Receipt } = await import("@/models/Receipt");
      const { default: Transaction } = await import("@/models/Transaction");
      const { GET: EXPORT } = await import("@/app/api/me/export/route");
      const { DELETE } = await import("@/app/api/me/route");
      const mine = await addTxn();
      const theirs = await addTxn({}, otherUserId);
      const r = await addReceipt({ userId, transactionId: mine._id.toString(), bytes: JPEG });
      await addReceipt({ userId: otherUserId, transactionId: theirs._id.toString(), bytes: JPEG });

      sessionUser.current = { id: userId, name: "TR User", email: "tr@x.com", role: "user" };
      const exported = await (await EXPORT()).json();
      expect(exported.receipts).toEqual([
        { id: r.id, transactionId: mine._id.toString(), contentType: "image/jpeg", size: JPEG.length, createdAt: expect.any(String) },
      ]);
      expect(JSON.stringify(exported.receipts)).not.toContain("data");

      expect((await DELETE()).status).toBe(200);
      sessionUser.current = null;
      expect(await Receipt.countDocuments({ user: userId })).toBe(0);
      expect(await Receipt.countDocuments({ user: otherUserId })).toBe(1);
      expect((await Transaction.findById(mine._id).lean<{ attachments: string[] }>())!.attachments).toEqual([]);
    });
  });

});

describe("tax helper", () => {
  const KEY = "test-tax-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let walletId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Tax User", email: `tax${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `taxo${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    accountId = (await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 0, currency: "INR" }))._id.toString();
    walletId = (await Account.create({ user: user._id, name: "Wallet", type: "cash", balance: 0, currency: "INR" }))._id.toString();
    otherAccountId = (await Account.create({ user: other._id, name: "Theirs", type: "bank", balance: 0, currency: "INR" }))._id.toString();
    userId = user._id.toString();
    otherUserId = other._id.toString();
  });

  const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${KEY}`, ...extra });
  async function summary(query = "") {
    const { GET } = await import("@/app/api/integrations/tax/route");
    return GET(new NextRequest(`http://localhost/api/integrations/tax${query}`, { headers: headers() }), {});
  }
  async function add(type: "income" | "expense" | "transfer", amount: number, date: string, extra: Record<string, unknown> = {}, who = userId) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({
      user: who,
      account: who === userId ? accountId : otherAccountId,
      type,
      amount,
      currency: "INR",
      category: type === "income" ? "Salary" : "Food",
      date: new Date(date),
      ...extra,
    });
  }
  async function setCategories(names: string[]) {
    const { default: User } = await import("@/models/User");
    await User.updateOne({ _id: userId }, { $set: { "preferences.tax.deductibleCategories": names } });
  }

  it("starts a year at 1 April in the user's zone and ends it at 31 March", async () => {
    await add("expense", 1000, "2025-03-31T18:29:00Z"); // 23:59 IST on 31 March 2025: previous year
    await add("expense", 2000, "2025-03-31T18:31:00Z"); // 00:01 IST on 1 April 2025: first minute of 2025-26
    await add("expense", 4000, "2026-03-31T18:29:00Z"); // 23:59 IST on 31 March 2026: last minute
    await add("expense", 8000, "2026-03-31T18:31:00Z"); // 2026-27
    const { data } = await (await summary("?fy=2025")).json();
    expect(data).toMatchObject({ fy: 2025, label: "2025-26", expense: 6000, count: 2 });
    expect(data.start).toBe("2025-03-31T18:30:00.000Z");
    expect(data.byMonth).toHaveLength(12);
    expect(data.byMonth[0]).toMatchObject({ month: "2025-04", expense: 2000 });
    expect(data.byMonth[11]).toMatchObject({ month: "2026-03", expense: 4000 });
    const next = (await (await summary("?fy=2026")).json()).data;
    expect(next.expense).toBe(8000);
  });

  it("buckets months in the user's zone", async () => {
    const { default: User } = await import("@/models/User");
    await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "America/New_York" } });
    // 02:00 UTC on 1 May is still 30 April in New York.
    await add("expense", 500, "2025-05-01T02:00:00Z");
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.timeZone).toBe("America/New_York");
    expect(data.byMonth[0]).toMatchObject({ month: "2025-04", expense: 500 });
    expect(data.byMonth[1].expense).toBe(0);
  });

  it("counts income and spending, leaving out transfers, voided and deleted rows", async () => {
    await add("income", 100000, "2025-06-10T06:00:00Z");
    await add("expense", 30000, "2025-06-11T06:00:00Z");
    await add("transfer", 50000, "2025-06-12T06:00:00Z", { transferTo: walletId });
    await add("expense", 9999, "2025-06-13T06:00:00Z", { reviewStatus: "voided" });
    await add("expense", 8888, "2025-06-14T06:00:00Z", { isDeleted: true });
    const { data } = await (await summary("?fy=2025")).json();
    expect(data).toMatchObject({ income: 100000, expense: 30000, saved: 70000, count: 2 });
    expect(data.incomeByCategory).toEqual([{ category: "Salary", total: 100000 }]);
  });

  it("counts a recurring instalment only once paid, on the day it was paid", async () => {
    const rid = new mongoose.Types.ObjectId();
    await add("expense", 700, "2025-04-05T06:00:00Z", { recurringId: rid, installmentStatus: "upcoming" });
    await add("expense", 900, "2025-04-20T06:00:00Z", { recurringId: rid, installmentStatus: "paid", paidAt: new Date("2026-04-02T06:00:00Z") });
    expect((await (await summary("?fy=2025")).json()).data.expense).toBe(0);
    expect((await (await summary("?fy=2026")).json()).data.expense).toBe(900);
  });

  it("takes a confirmed refund off spending and off the deductible total", async () => {
    await setCategories(["food"]);
    await add("expense", 10000, "2025-07-01T06:00:00Z");
    await add("income", 2500, "2025-07-05T06:00:00Z", { category: "Food", refundStatus: "confirmed" });
    await add("income", 700, "2025-07-06T06:00:00Z", { category: "Food", refundStatus: "suggested" }); // a suggestion is plain income
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.income).toBe(700);
    expect(data.expense).toBe(7500);
    expect(data.deductible.total).toBe(7500);
    expect(data.deductible.byCategory).toEqual([{ category: "Food", total: 7500 }]);
  });

  describe("refunds follow the expense they refund", () => {
    const refund = (orig: { _id: unknown }, amount: number, date: string, category = "Food") =>
      add("income", amount, date, { category, refundStatus: "confirmed", refundOf: orig._id });

    it("not deductible when the expense was flagged false, even in a listed category", async () => {
      await setCategories(["food"]);
      const exp = await add("expense", 10000, "2025-07-01T06:00:00Z", { deductible: false });
      await refund(exp, 2500, "2025-07-05T06:00:00Z");
      const { data } = await (await summary("?fy=2025")).json();
      expect(data.expense).toBe(7500);
      expect(data.deductible.total).toBe(0);
    });

    it("deductible when the expense was flagged true, even in an unlisted category", async () => {
      const exp = await add("expense", 10000, "2025-07-01T06:00:00Z", { category: "Gifts", deductible: true });
      await refund(exp, 2500, "2025-07-05T06:00:00Z", "Gifts");
      const { data } = await (await summary("?fy=2025")).json();
      expect(data.deductible.total).toBe(7500);
      expect(data.byMonth[3].deductible).toBe(7500);
    });

    it("counts in the year it arrived, so a later year's spending goes down", async () => {
      await setCategories(["food"]);
      const exp = await add("expense", 10000, "2025-08-01T06:00:00Z");
      await refund(exp, 2500, "2026-04-02T06:00:00Z");
      const first = (await (await summary("?fy=2025")).json()).data;
      expect(first).toMatchObject({ expense: 10000 });
      expect(first.deductible.total).toBe(10000);
      const next = (await (await summary("?fy=2026")).json()).data;
      expect(next.expense).toBe(-2500);
      expect(next.deductible.total).toBe(-2500);
      expect(next.saved).toBe(2500);
    });

    it("is skipped when the expense is voided or deleted", async () => {
      const voided = await add("expense", 10000, "2025-07-01T06:00:00Z", { reviewStatus: "voided" });
      const gone = await add("expense", 6000, "2025-07-02T06:00:00Z", { isDeleted: true });
      await refund(voided, 2500, "2025-07-05T06:00:00Z");
      await refund(gone, 1000, "2025-07-06T06:00:00Z");
      const { data } = await (await summary("?fy=2025")).json();
      expect(data).toMatchObject({ expense: 0, income: 0, count: 0 });
    });
  });

  describe("more refund cases", () => {
    const refund = (orig: { _id: unknown }, amount: number, date: string, category = "Food", extra: Record<string, unknown> = {}) =>
      add("income", amount, date, { category, refundStatus: "confirmed", refundOf: orig._id, ...extra });

    it("a refund in a later year follows its expense's flag, per year", async () => {
      await setCategories(["food"]);
      const yes = await add("expense", 10000, "2025-08-01T06:00:00Z", { category: "Gifts", deductible: true });
      const no = await add("expense", 8000, "2025-08-02T06:00:00Z", { deductible: false });
      await refund(yes, 2000, "2026-05-01T06:00:00Z", "Gifts");
      await refund(no, 500, "2026-05-02T06:00:00Z");
      const first = (await (await summary("?fy=2025")).json()).data;
      expect(first.deductible.total).toBe(10000);
      const next = (await (await summary("?fy=2026")).json()).data;
      expect(next.expense).toBe(-2500);
      expect(next.deductible.total).toBe(-2000);
    });

    it("a split refund takes deductibility from the one line it is linked to (known limit)", async () => {
      await setCategories(["health"]);
      const group = new mongoose.Types.ObjectId();
      const medical = await add("expense", 6000, "2025-09-01T06:00:00Z", { category: "Health", splitGroupId: group });
      await add("expense", 4000, "2025-09-01T06:00:00Z", { category: "Food", splitGroupId: group });
      await refund(medical, 1000, "2025-09-10T06:00:00Z", "Health");
      const { data } = await (await summary("?fy=2025")).json();
      expect(data.deductible.total).toBe(5000);
      expect(data.expense).toBe(9000);
    });

    it("a refund pointing at another user's expense does not read it", async () => {
      await setCategories(["food"]);
      const theirs = await add("expense", 5000, "2025-09-01T06:00:00Z", { reviewStatus: "voided", deductible: false }, otherUserId);
      await refund(theirs, 700, "2025-09-05T06:00:00Z");
      const { data } = await (await summary("?fy=2025")).json();
      // not skipped as "voided", and the other user's flag does not apply: its own category does
      expect(data.expense).toBe(-700);
      expect(data.deductible.total).toBe(-700);
    });
  });

  it("totals every refund when they span more than one chunk of expense ids", async () => {
    const { ID_CHUNK } = await import("@/lib/tax-service");
    const { default: Transaction } = await import("@/models/Transaction");
    await setCategories(["food"]);
    const count = ID_CHUNK + 150;
    const ids = Array.from({ length: count }, () => new mongoose.Types.ObjectId());
    const base = { user: userId, account: accountId, currency: "INR", category: "Food" };
    await Transaction.insertMany(ids.map((_id, i) => ({ ...base, _id, type: "expense", amount: 100, date: new Date(Date.UTC(2025, 5, 1 + (i % 20), 6)) })));
    await Transaction.insertMany(
      ids.map((refundOf, i) => ({ ...base, type: "income", amount: 30, refundStatus: "confirmed", refundOf, date: new Date(Date.UTC(2025, 6, 1 + (i % 20), 6)) }))
    );
    // one of them was voided after: its refund must drop out, wherever it sits in the id list
    await Transaction.updateOne({ _id: ids[count - 1] }, { $set: { reviewStatus: "voided" } });
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.expense).toBe((count - 1) * 70);
    expect(data.deductible.total).toBe((count - 1) * 70);
    expect(data.count).toBe((count - 1) * 2);
  });

  it("a refund whose expense no longer exists still counts, in its own category", async () => {
    await setCategories(["food"]);
    await add("income", 700, "2025-09-05T06:00:00Z", { category: "Food", refundStatus: "confirmed", refundOf: new mongoose.Types.ObjectId() });
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.expense).toBe(-700);
    expect(data.deductible.total).toBe(-700);
  });

  it("years include paid instalments with no paidAt and rows from before isDeleted existed", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const rid = new mongoose.Types.ObjectId();
    await add("expense", 900, "2019-06-10T06:00:00Z", { recurringId: rid, isRecurring: true, installmentStatus: "paid" });
    // raw insert: no isDeleted field at all, as an old document would be
    await Transaction.collection.insertOne({
      user: new mongoose.Types.ObjectId(userId),
      account: new mongoose.Types.ObjectId(accountId),
      type: "expense",
      amount: 400,
      currency: "INR",
      category: "Food",
      date: new Date("2018-06-10T06:00:00Z"),
    });
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.availableYears).toEqual(expect.arrayContaining([2025, 2019, 2018]));
    expect(data.availableYears.at(-1)).toBe(2018);
    // and the 2019 instalment is counted, by its date
    expect((await (await summary("?fy=2019")).json()).data.expense).toBe(900);
    expect((await (await summary("?fy=2018")).json()).data.expense).toBe(400);
  });

  it("the year reads stop at the first row on the indexes", async () => {
    const { yearRangeReads } = await import("@/lib/tax-service");
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.syncIndexes();
    const rid = new mongoose.Types.ObjectId();
    const rows = Array.from({ length: 300 }, (_, i) => ({
      user: userId,
      account: accountId,
      type: "expense",
      amount: 100,
      currency: "INR",
      category: "Food",
      date: new Date(Date.UTC(2023, 0, 1 + (i % 28), 6)),
      isDeleted: i % 5 === 0 ? undefined : false,
    }));
    await Transaction.insertMany(rows);
    // many paid recurring rows with a stamp: the paidAt reads must stop at the first, not walk them all
    await Transaction.insertMany(
      Array.from({ length: 40 }, (_, i) => ({
        user: userId,
        account: accountId,
        type: "expense",
        amount: 100,
        currency: "INR",
        category: "Food",
        isRecurring: true,
        recurringId: rid,
        installmentStatus: "paid",
        isDeleted: false,
        date: new Date(Date.UTC(2023, 1, 1 + (i % 20), 6)),
        paidAt: new Date(Date.UTC(2023, 1, 1 + (i % 20), 8)),
      }))
    );
    await Transaction.collection.insertOne({
      user: new mongoose.Types.ObjectId(userId),
      account: new mongoose.Types.ObjectId(accountId),
      type: "expense",
      amount: 100,
      currency: "INR",
      category: "Food",
      date: new Date(Date.UTC(2023, 0, 1, 5)),
    });
    await add("expense", 100, "2023-03-01T06:00:00Z", { recurringId: rid, isRecurring: true, installmentStatus: "paid" });
    const reads = yearRangeReads(new mongoose.Types.ObjectId(userId));
    for (const q of Object.values(reads)) {
      const plan = (await (q as unknown as { explain: (v: string) => Promise<Record<string, unknown>> }).explain("executionStats")) as {
        executionStats: { totalDocsExamined: number };
      };
      expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(5);
    }
    const { data } = await (await summary("?fy=2022")).json();
    // every row falls in 2022-23 (January to March 2023)
    expect(data.availableYears).toEqual([2022]);
  });

  it("matches category names beyond ASCII, the same way on both sides", async () => {
    const { PUT } = await import("@/app/api/integrations/tax/settings/route");
    await PUT(
      new NextRequest("http://localhost/api/integrations/tax/settings", {
        method: "PUT",
        headers: headers({ "idempotency-key": "tax-unicode", "content-type": "application/json" }),
        body: JSON.stringify({ deductibleCategories: ["ÉDUCATION"] }),
      }),
      {}
    );
    await add("expense", 3000, "2025-09-01T06:00:00Z", { category: "Éducation" });
    await add("expense", 2000, "2025-09-02T06:00:00Z", { category: "éducation" });
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.deductibleCategories).toEqual(["éducation"]);
    expect(data.deductible.total).toBe(5000);
    expect(data.deductible.byCategory).toHaveLength(1);
  });

  it("lists the years from the first row to the last, gaps included, without scanning every row", async () => {
    await add("expense", 100, "2022-06-01T06:00:00Z");
    await add("expense", 100, "2024-06-01T06:00:00Z");
    const rid = new mongoose.Types.ObjectId();
    await add("expense", 100, "2024-06-02T06:00:00Z", { recurringId: rid, installmentStatus: "paid", paidAt: new Date("2027-05-01T06:00:00Z") });
    const { data } = await (await summary("?fy=2024")).json();
    expect(data.availableYears).toEqual([2027, 2026, 2025, 2024, 2023, 2022]);
    // an empty account still offers the year asked for
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.deleteMany({});
    expect((await (await summary("?fy=2020")).json()).data.availableYears).toEqual([2020]);
  });

  it("settings: change the list by what moved, atomically, within 50 names", async () => {
    const { PATCH } = await import("@/app/api/integrations/tax/settings/route");
    const patch = (body: unknown, key = `d-${Math.random().toString(36).slice(2)}`) =>
      PATCH(
        new NextRequest("http://localhost/api/integrations/tax/settings", {
          method: "PATCH",
          headers: headers(key ? { "idempotency-key": key, "content-type": "application/json" } : {}),
          body: JSON.stringify(body),
        }),
        {}
      );
    expect((await patch({ add: ["x"] }, "")).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ add: [""] })).status).toBe(400);
    expect((await patch({ add: ["a"], other: 1 })).status).toBe(400);
    expect((await (await patch({ add: [" Health ", "Rent"] })).json()).data.deductibleCategories).toEqual(["health", "rent"]);
    // two changes in a row both stick
    await patch({ add: ["travel"] });
    expect((await (await patch({ remove: ["RENT"] })).json()).data.deductibleCategories).toEqual(["health", "travel"]);
    // removing wins over adding the same name
    expect((await (await patch({ add: ["gifts"], remove: ["gifts"] })).json()).data.deductibleCategories).toEqual(["health", "travel"]);
    // removing a name that is not there changes nothing
    expect((await (await patch({ remove: ["nothing"] })).json()).data.deductibleCategories).toEqual(["health", "travel"]);
    await setCategories(Array.from({ length: 49 }, (_, i) => `c${String(i).padStart(2, "0")}`));
    expect((await (await patch({ add: ["last"] })).json()).data.deductibleCategories).toHaveLength(50);
    expect((await patch({ add: ["one-too-many"] }, "cap-retry")).status).toBe(400);
    // the 400 is not remembered: free a slot and the same key and body now work
    await patch({ remove: ["c01"] });
    const retry = await patch({ add: ["one-too-many"] }, "cap-retry");
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.deductibleCategories).toContain("one-too-many");
    expect((await (await patch({ add: ["c00"] })).json()).data.deductibleCategories).toHaveLength(50); // already there
    const { PATCH: browserPatch } = await import("@/app/api/tax/settings/route");
    sessionUser.current = { id: userId, name: "Tax User", email: "t@x.com", role: "user" };
    const res = await browserPatch(new NextRequest("http://localhost/api/tax/settings", { method: "PATCH", body: JSON.stringify({ remove: ["last"] }) }));
    expect((await res.json()).data.deductibleCategories).toHaveLength(49);
    expect((await browserPatch(new NextRequest("http://localhost/api/tax/settings", { method: "PATCH", body: "{}" }))).status).toBe(400);
    sessionUser.current = null;
    expect((await browserPatch(new NextRequest("http://localhost/api/tax/settings", { method: "PATCH", body: "{}" }))).status).toBe(401);
  });

  it("deductible follows the category list, and a flag on the row wins", async () => {
    await setCategories(["health"]);
    await add("expense", 4000, "2025-08-01T06:00:00Z", { category: "Health" });
    await add("expense", 1500, "2025-08-02T06:00:00Z", { category: "health", deductible: false });
    await add("expense", 600, "2025-08-03T06:00:00Z", { category: "Food", deductible: true });
    await add("expense", 300, "2025-08-04T06:00:00Z", { category: "Food" });
    await add("income", 99999, "2025-08-05T06:00:00Z", { category: "Health" }); // income is never deductible
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.deductible.total).toBe(4600);
    expect(data.deductible.byCategory).toEqual([
      { category: "Health", total: 4000 },
      { category: "Food", total: 600 },
    ]);
    expect(data.byMonth[4].deductible).toBe(4600);
    expect(data.expense).toBe(6400);
  });

  it("defaults to the current year, validates fy and lists the years with data", async () => {
    await add("expense", 100, "2023-05-01T06:00:00Z");
    await add("expense", 100, "2024-02-01T06:00:00Z");
    const { data } = await (await summary()).json();
    const { currentFy } = await import("@/lib/tax-year");
    expect(data.fy).toBe(currentFy(new Date(), "Asia/Kolkata"));
    expect(data.availableYears).toEqual(expect.arrayContaining([data.fy, 2023]));
    expect(data.availableYears.filter((y: number) => y === 2023)).toHaveLength(1);
    for (const bad of ["?fy=abc", "?fy=25", "?fy=1999", "?fy=2025.5", "?fy="]) {
      expect((await summary(bad)).status).toBe(400);
    }
  });

  it("is per user", async () => {
    await add("expense", 4000, "2025-08-01T06:00:00Z", {}, otherUserId);
    await add("expense", 100, "2025-08-01T06:00:00Z");
    const { data } = await (await summary("?fy=2025")).json();
    expect(data.expense).toBe(100);
    expect(data.count).toBe(1);
  });

  it("settings: save the category list, trimmed and lower case, needs an Idempotency-Key", async () => {
    const { GET, PUT } = await import("@/app/api/integrations/tax/settings/route");
    const put = (body: unknown, key = "tax-set-1") =>
      PUT(
        new NextRequest("http://localhost/api/integrations/tax/settings", {
          method: "PUT",
          headers: headers(key ? { "idempotency-key": key, "content-type": "application/json" } : {}),
          body: JSON.stringify(body),
        }),
        {}
      );
    expect((await put({ deductibleCategories: ["x"] }, "")).status).toBe(400);
    expect((await put({ deductibleCategories: [""] })).status).toBe(400);
    expect((await put({ deductibleCategories: ["a".repeat(41)] })).status).toBe(400);
    expect((await put({ deductibleCategories: Array.from({ length: 51 }, (_, i) => `c${i}`) })).status).toBe(400);
    expect((await put({ deductibleCategories: ["x"], extra: 1 })).status).toBe(400);
    const res = await put({ deductibleCategories: [" Health ", "health", "Rent"] }, "tax-set-2");
    expect(res.status).toBe(200);
    expect((await res.json()).data.deductibleCategories).toEqual(["health", "rent"]);
    const got = await GET(new NextRequest("http://localhost/api/integrations/tax/settings", { headers: headers() }), {});
    expect((await got.json()).data).toEqual({ deductibleCategories: ["health", "rent"] });
    // replaying the same key and body returns the first answer
    const replay = await put({ deductibleCategories: [" Health ", "health", "Rent"] }, "tax-set-2");
    expect(replay.status).toBe(200);
    const clash = await put({ deductibleCategories: ["other"] }, "tax-set-2");
    expect(clash.status).toBe(409);
  });

  it("flag one expense, clear it, and reject other users, transfers and bad ids", async () => {
    const { PATCH } = await import("@/app/api/integrations/tax/transactions/[id]/route");
    const patch = (id: string, body: unknown, key = `k-${Math.random().toString(36).slice(2)}`) =>
      PATCH(
        new NextRequest(`http://localhost/api/integrations/tax/transactions/${id}`, {
          method: "PATCH",
          headers: headers({ "idempotency-key": key, "content-type": "application/json" }),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) }
      );
    const mine = await add("expense", 4000, "2025-09-01T06:00:00Z");
    const theirs = await add("expense", 4000, "2025-09-01T06:00:00Z", {}, otherUserId);
    const move = await add("transfer", 4000, "2025-09-01T06:00:00Z", { transferTo: walletId });
    const res = await patch(mine._id.toString(), { deductible: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: mine._id.toString(), deductible: true });
    expect((await (await summary("?fy=2025")).json()).data.deductible.total).toBe(4000);
    expect((await patch(mine._id.toString(), { deductible: null })).status).toBe(200);
    expect((await (await summary("?fy=2025")).json()).data.deductible.total).toBe(0);
    expect((await patch(theirs._id.toString(), { deductible: true })).status).toBe(404);
    expect((await patch(move._id.toString(), { deductible: true })).status).toBe(404);
    expect((await patch("not-an-id", { deductible: true })).status).toBe(400);
    expect((await patch(mine._id.toString(), { deductible: "yes" })).status).toBe(400);
    expect((await patch(mine._id.toString(), {})).status).toBe(400);
  });

  it("csv: the summary as a file, text starting with a formula character is quoted, negatives stay numbers", async () => {
    await add("expense", 5000, "2025-06-01T06:00:00Z", { category: "=HYPERLINK(1)" });
    await add("expense", 300, "2025-06-02T06:00:00Z", { category: "Food" });
    const { GET } = await import("@/app/api/integrations/tax/export/route");
    const res = await GET(new NextRequest("http://localhost/api/integrations/tax/export?fy=2025", { headers: headers() }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("tax-summary-2025-26.csv");
    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toBe("section,name,amount (INR)");
    expect(lines).toContain("Summary,Saved,-53");
    expect(lines).toContain("Summary,Financial year,2025-26");
    expect(text).toContain("Spending by category,'=HYPERLINK(1),50");
    expect(text).not.toContain(",=HYPERLINK");
    const bad = await GET(new NextRequest("http://localhost/api/integrations/tax/export?fy=zzz", { headers: headers() }), {});
    expect(bad.status).toBe(400);
  });

  describe("base currency", () => {
    const csvFor = async (fy = 2025) => {
      const { GET } = await import("@/app/api/integrations/tax/export/route");
      const res = await GET(new NextRequest(`http://localhost/api/integrations/tax/export?fy=${fy}`, { headers: headers() }), {});
      return (await res.text()).split("\n");
    };
    const setBase = async (code: string) => {
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: userId }, { $set: { "preferences.currency": code } });
    };

    // [code, decimals, spent, earned (minor units), spent shown, saved shown]
    it.each([
      ["JPY", 0, 5000, 4000, "5000", "-1000"],
      ["USD", 2, 123456, 122222, "1234.56", "-12.34"],
      ["KWD", 3, 12345, 11111, "12.345", "-1.234"],
    ])("%s: the csv amounts and header follow its %i decimals", async (code, exponent, spent, earned, spentShown, savedShown) => {
      await setBase(code as string);
      await add("expense", spent as number, "2025-06-01T06:00:00Z");
      await add("income", earned as number, "2025-06-02T06:00:00Z");
      const lines = await csvFor();
      expect(lines[0]).toBe(`section,name,amount (${code})`);
      expect(lines).toContain(`Spending by category,Food,${spentShown}`);
      expect(lines).toContain(`Summary,Saved,${savedShown}`);
      const { data } = await (await summary("?fy=2025")).json();
      expect(data).toMatchObject({ currency: code, exponent, expense: spent });
    });

    it("sums the base amount and ignores the foreign original", async () => {
      await setBase("INR");
      // 100.00 USD booked at 83 INR: 8300.00 INR is 830000 paise; only `amount` (base) counts, not originalAmount
      await add("expense", 830000, "2025-06-01T06:00:00Z", { originalAmount: 10000, originalCurrency: "USD", rate: 83 });
      await add("income", 5000, "2025-06-02T06:00:00Z", { originalAmount: 60, originalCurrency: "EUR", rate: 90 });
      const { data } = await (await summary("?fy=2025")).json();
      expect(data).toMatchObject({ expense: 830000, income: 5000, saved: -825000, count: 2 });
      expect(data.expenseByCategory).toEqual([{ category: "Food", total: 830000 }]);
    });

    it("counts each split line once", async () => {
      await setCategories(["health"]);
      const group = new mongoose.Types.ObjectId();
      await add("expense", 6000, "2025-09-01T06:00:00Z", { category: "Health", splitGroupId: group });
      await add("expense", 4000, "2025-09-01T06:00:00Z", { category: "Food", splitGroupId: group });
      const { data } = await (await summary("?fy=2025")).json();
      expect(data).toMatchObject({ expense: 10000, count: 2 });
      expect(data.deductible.total).toBe(6000);
    });
  });

  it("browser routes answer the same summary, settings and csv", async () => {
    await add("expense", 2000, "2025-06-01T06:00:00Z", { category: "Health" });
    sessionUser.current = { id: userId, name: "Tax User", email: "t@x.com", role: "user" };
    const { GET } = await import("@/app/api/tax/route");
    const { PUT } = await import("@/app/api/tax/settings/route");
    const { GET: exportCsv } = await import("@/app/api/tax/export/route");
    const put = await PUT(new NextRequest("http://localhost/api/tax/settings", { method: "PUT", body: JSON.stringify({ deductibleCategories: ["Health"] }) }));
    expect(put.status).toBe(200);
    const res = await GET(new NextRequest("http://localhost/api/tax?fy=2025"));
    expect((await res.json()).data.deductible.total).toBe(2000);
    expect((await GET(new NextRequest("http://localhost/api/tax?fy=nope"))).status).toBe(400);
    const csv = await exportCsv(new NextRequest("http://localhost/api/tax/export?fy=2025"));
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Deductible by category,Health,20");
    sessionUser.current = null;
    expect((await GET(new NextRequest("http://localhost/api/tax"))).status).toBe(401);
  });
});

describe("budgets csv", () => {
  it("remaining stays a number when over budget", async () => {
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const { default: Budget } = await import("@/models/Budget");
    const { default: Transaction } = await import("@/models/Transaction");
    const user = await User.create({ name: "B", email: `bc${Date.now()}@x.com`, password: "hash", isActive: true });
    const account = await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 0, currency: "INR" });
    const now = new Date();
    await Budget.create({ user: user._id, category: "Food", month: now.getMonth() + 1, year: now.getFullYear(), limitAmount: 10000 });
    await Transaction.create({ user: user._id, account: account._id, type: "expense", amount: 25000, currency: "INR", category: "Food", date: new Date(now.getFullYear(), now.getMonth(), 2, 12) });
    sessionUser.current = { id: user._id.toString(), name: "B", email: "b@x.com", role: "user" };
    const { GET } = await import("@/app/api/budgets/route");
    const res = await GET(new NextRequest(`http://localhost/api/budgets?format=csv&month=${now.getMonth() + 1}&year=${now.getFullYear()}`));
    const row = (await res.text()).split("\n")[1].split(",");
    expect(row[6]).toBe("-150");
    sessionUser.current = null;
  });
});

// ── export and import ──────────────────────────────────────────────────────

describe("csv import helpers", () => {
  it("parses quotes, doubled quotes, CRLF, a BOM and other delimiters", async () => {
    const { parseCsv } = await import("@/lib/csv-import");
    const t = parseCsv('﻿Date;Narration;Amount\r\n01/02/2026;"Tea, ""big"" cup";-12.50\r\n\r\n02/02/2026;Rent;5000\r\n');
    expect(t.delimiter).toBe(";");
    expect(t.headers).toEqual(["Date", "Narration", "Amount"]);
    expect(t.rows).toEqual([
      ["01/02/2026", 'Tea, "big" cup', "-12.50"],
      ["02/02/2026", "Rent", "5000"],
    ]);
  });

  it("refuses an empty file, too many rows and too much text", async () => {
    const { parseCsv, IMPORT_MAX_ROWS, IMPORT_MAX_BYTES } = await import("@/lib/csv-import");
    expect(() => parseCsv("")).toThrow();
    const many = ["a,b", ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => "1,2")].join("\n");
    expect(() => parseCsv(many)).toThrow(/rows/);
    expect(() => parseCsv("x".repeat(IMPORT_MAX_BYTES + 1))).toThrow(/large/);
    const exactly = ["a,b", ...Array.from({ length: IMPORT_MAX_ROWS }, () => "1,2")].join("\n");
    expect(parseCsv(exactly).rows).toHaveLength(IMPORT_MAX_ROWS);
  });

  it("reads amounts to integer paise and refuses what it cannot read", async () => {
    const { parseAmountCell } = await import("@/lib/csv-import");
    expect(parseAmountCell("1,234.50")).toBe(123450);
    expect(parseAmountCell("₹ 99")).toBe(9900);
    expect(parseAmountCell("-12.5")).toBe(-1250);
    expect(parseAmountCell("(500.00)")).toBe(-50000);
    expect(parseAmountCell("250 Dr")).toBe(-25000);
    expect(parseAmountCell("250 Cr")).toBe(25000);
    // Any negative marker makes it negative; Cr with one is refused, not guessed.
    expect(parseAmountCell("-250 Dr")).toBe(-25000);
    expect(parseAmountCell("(-500.00)")).toBe(-50000);
    expect(parseAmountCell("(500 Dr)")).toBe(-50000);
    expect(parseAmountCell("500 Cr")).toBe(50000);
    expect(parseAmountCell("(500 Cr)")).toBeNull();
    expect(parseAmountCell("-250 Cr")).toBeNull();
    expect(parseAmountCell("--5")).toBeNull();
    expect(parseAmountCell("0.10")).toBe(10);
    expect(parseAmountCell("1,23,456.78")).toBe(12345678);
    expect(parseAmountCell("1,234")).toBe(123400);
    expect(parseAmountCell("-12,345.00")).toBe(-1234500);
    // A lone comma could be a decimal comma, so it is refused, not read as 1250.
    expect(parseAmountCell("12,50")).toBeNull();
    expect(parseAmountCell("1,00")).toBeNull();
    expect(parseAmountCell("1,2345")).toBeNull();
    expect(parseAmountCell("1,,234")).toBeNull();
    expect(parseAmountCell("1.234")).toBeNull();
    expect(parseAmountCell("abc")).toBeNull();
    expect(parseAmountCell("")).toBeNull();
    expect(parseAmountCell("9".repeat(20))).toBeNull();
  });

  it("reads dates in the chosen order and refuses impossible ones", async () => {
    const { parseDateCell } = await import("@/lib/csv-import");
    expect(parseDateCell("03/04/2026", "dmy")).toEqual({ y: 2026, m: 4, d: 3 });
    expect(parseDateCell("03/04/2026", "mdy")).toEqual({ y: 2026, m: 3, d: 4 });
    expect(parseDateCell("2026-04-03T10:00:00Z", "dmy")).toEqual({ y: 2026, m: 4, d: 3 });
    expect(parseDateCell("3 Apr 2026", "dmy")).toEqual({ y: 2026, m: 4, d: 3 });
    expect(parseDateCell("03-Apr-26", "dmy")).toEqual({ y: 2026, m: 4, d: 3 });
    expect(parseDateCell("31/02/2026", "dmy")).toBeNull();
    expect(parseDateCell("hello", "dmy")).toBeNull();
  });

  it("reads amounts in linear time even from a huge cell of spaces", async () => {
    const { parseAmountCell } = await import("@/lib/csv-import");
    const start = Date.now();
    expect(parseAmountCell(" ".repeat(1_000_000) + "x")).toBeNull();
    expect(parseAmountCell("5" + " ".repeat(1_000_000) + "dr")).toBeNull();
    // A backtracking blow-up would take minutes; this only guards that, so the bound is loose.
    expect(Date.now() - start).toBeLessThan(5000);
    // Whole-file parse of a 1 MB cell of spaces is fast as well.
    const { parseCsv, rowToCandidate } = await import("@/lib/csv-import");
    const t0 = Date.now();
    const table = parseCsv(`Date,Amount\n01/10/2026,${" ".repeat(900_000)}250${" ".repeat(50_000)}Dr`);
    const out = rowToCandidate(table.rows[0], 1, { date: 0, amount: 1 }, { mapping: {}, dateOrder: "dmy", amountSign: "signed", now: new Date(), timeZone: "Asia/Kolkata" });
    expect(out.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("stays linear on short adversarial amount cells", async () => {
    const { parseAmountCell } = await import("@/lib/csv-import");
    const start = Date.now();
    for (let i = 0; i < 200; i += 1) {
      for (const cell of ["1,".repeat(31) + "x", "1,111".repeat(12) + "x", "(" + "1,".repeat(30), "9".repeat(60) + "dr x", "-".repeat(63) + "1", " ".repeat(30) + "1" + " ".repeat(30) + "cr"]) {
        expect(cell.length).toBeLessThanOrEqual(64);
        parseAmountCell(cell);
      }
    }
    // 1,200 calls; exponential backtracking would not finish. Loose on purpose, a loaded machine must not flake.
    expect(Date.now() - start).toBeLessThan(20_000);
  });

  it("reads only four-digit-year-first dates when told ymd", async () => {
    const { parseDateCell } = await import("@/lib/csv-import");
    expect(parseDateCell("2026/10/05", "ymd")).toEqual({ y: 2026, m: 10, d: 5 });
    expect(parseDateCell("2026-10-05", "ymd")).toEqual({ y: 2026, m: 10, d: 5 });
    expect(parseDateCell("2026.10.05", "ymd")).toEqual({ y: 2026, m: 10, d: 5 });
    // Two digits first could just as well be day first: refused, never guessed.
    expect(parseDateCell("24-10-26", "ymd")).toBeNull();
    expect(parseDateCell("05-10-26", "ymd")).toBeNull();
    expect(parseDateCell("26.1.5", "ymd")).toBeNull();
    expect(parseDateCell("05/10/2026", "ymd")).toBeNull();
    expect(parseDateCell("2026-13-01", "ymd")).toBeNull();
    expect(parseDateCell("26-02-30", "ymd")).toBeNull();
  });

  it("flags only dates that read two ways", async () => {
    const { dateIsAmbiguous } = await import("@/lib/csv-import");
    expect(dateIsAmbiguous("03/04/2026")).toBe(true);
    expect(dateIsAmbiguous("13/04/2026")).toBe(false);
    expect(dateIsAmbiguous("04/13/2026")).toBe(false);
    expect(dateIsAmbiguous("05/05/2026")).toBe(false);
    expect(dateIsAmbiguous("2026-04-03")).toBe(false);
    expect(dateIsAmbiguous("3 Apr 2026")).toBe(false);
  });

  it("lands a date on its own calendar day in the user's zone", async () => {
    const { rowToCandidate } = await import("@/lib/csv-import");
    const { localDateKey } = await import("@/lib/spend-limit-time");
    for (const tz of ["Pacific/Auckland", "Pacific/Kiritimati", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Pago_Pago"]) {
      const out = rowToCandidate(["05/10/2026", "10"], 1, { date: 0, amount: 1 }, { mapping: {}, dateOrder: "dmy", amountSign: "signed", now: new Date(), timeZone: tz });
      if (!out.ok) throw new Error("row should read");
      expect(localDateKey(out.candidate.date, tz)).toBe("2026-10-05");
    }
  });

  it("starts a day at its first real instant where a clock change skips midnight", async () => {
    const { localMidnight, localDateKey, dayWindow } = await import("@/lib/spend-limit-time");
    const keyOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // Midnight does not exist on these days: 00:00 jumps to 01:00.
    for (const [tz, y, m, d, utc] of [
      ["America/Santiago", 2026, 9, 6, "2026-09-06T04:00:00.000Z"],
      ["Asia/Beirut", 2026, 3, 29, "2026-03-28T22:00:00.000Z"],
    ] as const) {
      const start = localMidnight(tz, y, m, d);
      expect(start.toISOString()).toBe(utc);
      expect(localDateKey(start, tz)).toBe(keyOf(y, m, d));
      expect(localDateKey(new Date(start.getTime() - 1000), tz)).not.toBe(keyOf(y, m, d));
      // That day is an hour short, and the day window agrees.
      expect(localMidnight(tz, y, m, d + 1).getTime() - start.getTime()).toBe(23 * 3_600_000);
      const win = dayWindow(new Date(start.getTime() + 3_600_000), tz, 1);
      expect(win.dayStart.toISOString()).toBe(utc);
    }
    // Every day around every kind of change starts on its own date, in order.
    for (const [tz, y, m] of [["America/Santiago", 2026, 9], ["Asia/Beirut", 2026, 3], ["America/Havana", 2026, 11], ["Australia/Lord_Howe", 2026, 10], ["Pacific/Auckland", 2026, 9], ["America/New_York", 2026, 11], ["Asia/Amman", 2011, 10], ["Antarctica/Davis", 2011, 10]] as const) {
      let prev = 0;
      for (let d = 1; d <= 30; d += 1) {
        const start = localMidnight(tz, y, m, d);
        expect(localDateKey(start, tz)).toBe(keyOf(y, m, d));
        expect(localDateKey(new Date(start.getTime() - 1000), tz)).not.toBe(keyOf(y, m, d));
        expect(start.getTime()).toBeGreaterThan(prev);
        prev = start.getTime();
      }
    }
  });

  it("takes the first of a midnight that happens twice, and gives a skipped day to the next one", async () => {
    const { localMidnight, localDateKey } = await import("@/lib/spend-limit-time");
    for (const tz of ["Asia/Amman", "Antarctica/Davis"]) {
      const start = localMidnight(tz, 2011, 10, 28);
      expect(localDateKey(start, tz)).toBe("2011-10-28");
      expect(localDateKey(new Date(start.getTime() - 1000), tz)).toBe("2011-10-27");
    }
    // Samoa skipped 2011-12-30: no start of its own, so the helper gives 12-31's.
    const apia = localMidnight("Pacific/Apia", 2011, 12, 30);
    expect(localDateKey(apia, "Pacific/Apia")).toBe("2011-12-31");
    expect(apia.getTime()).toBe(localMidnight("Pacific/Apia", 2011, 12, 31).getTime());
  });

  it("explains a short year under ymd, but not a four-digit year that is not a date", async () => {
    const { rowToCandidate } = await import("@/lib/csv-import");
    const opts = { mapping: {}, dateOrder: "ymd" as const, amountSign: "signed" as const, now: new Date("2026-12-01T00:00:00Z"), timeZone: "Asia/Kolkata" };
    const msg = (cell: string) => {
      const out = rowToCandidate([cell, "5"], 1, { date: 0, amount: 1 }, opts);
      if (out.ok) throw new Error("should not read");
      return out.error.message;
    };
    expect(msg("24-10-26")).toContain("year first needs four digits");
    expect(msg("2026-13-01")).toBe('Cannot read the date "2026-13-01"');
    expect(msg("2026-02-30")).toBe('Cannot read the date "2026-02-30"');
    expect(msg("garbage")).toBe('Cannot read the date "garbage"');
  });

  it("an import row on a day the zone skipped is a row error", async () => {
    const { rowToCandidate } = await import("@/lib/csv-import");
    const opts = { mapping: {}, dateOrder: "ymd" as const, amountSign: "signed" as const, now: new Date("2012-06-01T00:00:00Z"), timeZone: "Pacific/Apia" };
    const skipped = rowToCandidate(["2011-12-30", "5"], 3, { date: 0, amount: 1 }, opts);
    expect(skipped).toEqual({ ok: false, error: { row: 3, field: "date", message: expect.stringContaining("does not exist") } });
    expect(rowToCandidate(["2011-12-31", "5"], 4, { date: 0, amount: 1 }, opts).ok).toBe(true);
    const ymd = rowToCandidate(["24-10-26", "5"], 5, { date: 0, amount: 1 }, opts);
    expect(ymd).toEqual({ ok: false, error: { row: 5, field: "date", message: expect.stringContaining("year first needs four digits") } });
    expect(rowToCandidate(["2026-10-24", "5"], 6, { date: 0, amount: 1 }, { ...opts, now: new Date("2027-01-01T00:00:00Z") }).ok).toBe(true);
  });

  it("guesses a mapping from common bank headers", async () => {
    const { suggestMapping } = await import("@/lib/csv-import");
    expect(suggestMapping(["Txn Date", "Narration", "Withdrawal Amt", "Deposit Amt", "Balance"])).toEqual({
      date: "Txn Date",
      description: "Narration",
      debit: "Withdrawal Amt",
      credit: "Deposit Amt",
    });
    expect(suggestMapping(["Date", "Description", "Amount"])).toMatchObject({ date: "Date", amount: "Amount", description: "Description" });
  });
});

describe("integration export and import", () => {
  const KEY = "test-export-import-api-key";
  let userId: string;
  let otherUserId: string;
  let accountId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "EI", email: `ei${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `eio${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherUserId = other._id.toString();
    accountId = (await Account.create({ user: user._id, name: "Bank", type: "bank", balance: 100000, currency: "INR" }))._id.toString();
  });

  function req(path: string, method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `ei-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function preview(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/integrations/import/preview/route");
    return POST(req("import/preview", "POST", { accountId, ...body }), {});
  }
  async function commit(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/import/commit/route");
    return POST(req("import/commit", "POST", { accountId, dateOrder: "dmy", ...body }, headers), {});
  }
  async function exportCsv(query = "") {
    const { GET } = await import("@/app/api/integrations/export/transactions/route");
    return GET(req(`export/transactions${query}`, "GET"), {});
  }
  const statement = [
    "Date,Narration,Amount",
    "01/10/2026,Coffee,-120.00",
    "01/10/2026,Coffee,-120.00",
    "02/10/2026,Salary,50000",
    "bad,Oops,10",
    "03/10/2026,Zero,0",
  ].join("\n");

  it("preview reads the file, guesses columns and writes nothing", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const res = await preview({ csv: statement });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      mapping: { date: "Date", amount: "Amount", description: "Narration" },
      totalRows: 5,
      validCount: 3,
      invalidCount: 2,
      duplicateCount: 0,
      importCount: 3,
      incomeTotal: 5000000,
      expenseTotal: 24000,
    });
    expect(data.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
    expect(data.sample[0]).toMatchObject({ row: 1, date: "2026-10-01", type: "expense", amount: 12000, description: "Coffee", category: "other" });
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
  });

  it("commit writes rows as source import, leaves the balance alone, and replays on the same key", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const first = await commit({ csv: statement }, { "idempotency-key": "ik" });
    expect(first.status).toBe(201);
    const { data } = await first.json();
    expect(data).toMatchObject({ imported: 3, skippedDuplicates: 0, invalidCount: 2, failed: 0 });
    const rows = await Transaction.find({ user: userId }).sort({ date: 1 }).lean();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "import" && r.reviewStatus == null)).toBe(true);
    expect(rows[0]).toMatchObject({ type: "expense", amount: 12000, description: "Coffee", currency: "INR" });
    expect((await Account.findById(accountId))!.balance).toBe(100000);

    const replay = await commit({ csv: statement }, { "idempotency-key": "ik" });
    expect((await replay.json()).data.imported).toBe(3);
    expect(await Transaction.countDocuments({ user: userId })).toBe(3);

    const clash = await commit({ csv: statement, dateOrder: "mdy" }, { "idempotency-key": "ik" });
    expect(clash.status).toBe(409);
  });

  it("a different mapping under one key is a conflict, not a replay", async () => {
    await commit({ csv: statement, mapping: { date: "Date", amount: "Amount" } }, { "idempotency-key": "mk" });
    const other = await commit({ csv: statement, mapping: { date: "Date", amount: "Amount", description: "Narration" } }, { "idempotency-key": "mk" });
    expect(other.status).toBe(409);
  });

  it("adjustBalance moves the balance by the imported rows", async () => {
    const { default: Account } = await import("@/models/Account");
    await commit({ csv: statement, adjustBalance: true });
    // +50000.00 - 2 x 120.00
    expect((await Account.findById(accountId))!.balance).toBe(100000 + 5000000 - 24000);
  });

  it("a second import of the same file adds nothing; two equal rows on a day match two existing", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    await commit({ csv: statement });
    const again = await preview({ csv: statement });
    expect((await again.json()).data).toMatchObject({ validCount: 3, duplicateCount: 3, importCount: 0 });
    const done = await commit({ csv: statement });
    expect((await done.json()).data).toMatchObject({ imported: 0, skippedDuplicates: 3 });
    expect(await Transaction.countDocuments({ user: userId })).toBe(3);

    // A third coffee that day is new: only two exist already.
    const more = await preview({ csv: ["Date,Narration,Amount", "01/10/2026,Coffee,-120.00", "01/10/2026,Coffee,-120.00", "01/10/2026,Coffee,-120.00"].join("\n") });
    expect((await more.json()).data).toMatchObject({ duplicateCount: 2, importCount: 1 });
  });

  it("matches a row entered by hand, but not a deleted, voided or other account's row", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const sibling = await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0, currency: "INR" });
    const day = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));
    const base = { user: userId, account: accountId, type: "expense", amount: 4500, category: "food", date: day };
    await Transaction.create({ ...base, source: "sms", reviewStatus: "confirmed" });
    await Transaction.create({ ...base, isDeleted: true });
    await Transaction.create({ ...base, reviewStatus: "voided" });
    await Transaction.create({ ...base, account: sibling._id });
    const csv = "Date,Amount\n2026-10-05,-45.00\n2026-10-05,-45.00\n";
    const data = (await (await preview({ csv })).json()).data;
    expect(data).toMatchObject({ duplicateCount: 1, importCount: 1 });
    const all = await commit({ csv, includeDuplicates: true });
    expect((await all.json()).data).toMatchObject({ imported: 2, skippedDuplicates: 0 });
  });

  it("reads separate debit and credit columns and a type column", async () => {
    const dc = await preview({ csv: "Date,Particulars,Debit,Credit\n01/10/2026,Rent,15000,\n02/10/2026,Refund,,300.50\n03/10/2026,Both,1,1" });
    const d = (await dc.json()).data;
    expect(d.mapping).toMatchObject({ debit: "Debit", credit: "Credit" });
    expect(d.sample.map((s: { type: string; amount: number }) => [s.type, s.amount])).toEqual([["expense", 1500000], ["income", 30050]]);
    expect(d.invalidCount).toBe(1);

    const typed = await preview({ csv: "Date,Amount,Type,Category,Tags\n01/10/2026,100,Debit,Food,a;b\n02/10/2026,200,Credit,Salary," });
    const t = (await typed.json()).data;
    expect(t.sample.map((s: { type: string; category: string; tags: string[] }) => [s.type, s.category, s.tags])).toEqual([
      ["expense", "Food", ["a", "b"]],
      ["income", "Salary", []],
    ]);

    const forced = await preview({ csv: "Date,Amount\n01/10/2026,100", amountSign: "expense" });
    expect((await forced.json()).data.sample[0].type).toBe("expense");
  });

  it("asks for a mapping when the date or amount column is unknown, and rejects a bad one", async () => {
    const none = await preview({ csv: "Foo,Bar\n1,2" });
    expect(none.status).toBe(400);
    expect((await none.json()).error.details.code).toBe("NEEDS_MAPPING");
    const wrong = await preview({ csv: statement, mapping: { date: "Nope", amount: "Amount" } });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.details.missingColumns).toEqual(["Nope"]);
    const ok = await preview({ csv: "When,How much\n01/10/2026,5", mapping: { date: "When", amount: "How much" } });
    expect(ok.status).toBe(200);
  });

  it("validates the body, the account and the key", async () => {
    expect((await preview({ csv: "" })).status).toBe(400);
    expect((await preview({ csv: statement, accountId: "nope" })).status).toBe(400);
    expect((await preview({ csv: statement, surprise: 1 })).status).toBe(400);
    expect((await preview({ csv: statement, dateOrder: "xyz" })).status).toBe(400);
    expect((await preview({ csv: "x".repeat(1_000_001) })).status).toBe(400);
    const { POST } = await import("@/app/api/integrations/import/commit/route");
    const noKey = new NextRequest("http://localhost/api/integrations/import/commit", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ accountId, csv: statement }),
    });
    expect((await POST(noKey, {})).status).toBe(400);
  });

  it("never touches another user's account or archived accounts", async () => {
    const { default: Account } = await import("@/models/Account");
    const theirs = await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 0, currency: "INR" });
    expect((await preview({ csv: statement, accountId: theirs._id.toString() })).status).toBe(404);
    expect((await commit({ csv: statement, accountId: theirs._id.toString() })).status).toBe(404);
    const archived = await Account.create({ user: userId, name: "Old", type: "bank", balance: 0, currency: "INR", isArchived: true });
    expect((await commit({ csv: statement, accountId: archived._id.toString() })).status).toBe(404);
  });

  it("a duplicate in another user's account is not a duplicate for this user", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const theirs = await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 0, currency: "INR" });
    await Transaction.create({ user: otherUserId, account: theirs._id, type: "expense", amount: 12000, category: "food", date: new Date(Date.UTC(2026, 9, 1, 12)) });
    expect((await (await preview({ csv: statement })).json()).data.duplicateCount).toBe(0);
  });

  it("export lists real rows only, as major units, with formula cells defanged", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const theirs = await Account.create({ user: otherUserId, name: "Theirs", type: "bank", balance: 0, currency: "INR" });
    const at = (d: number) => new Date(Date.UTC(2026, 9, d, 6, 0, 0));
    const base = { user: userId, account: accountId, category: "food" };
    await Transaction.create({ ...base, type: "expense", amount: 125050, description: "=HYPERLINK(\"x\")", note: 'said "hi", ok', tags: ["a", "b"], date: at(2) });
    await Transaction.create({ ...base, type: "income", amount: 5, date: at(1) });
    await Transaction.create({ ...base, type: "expense", amount: 700, isDeleted: true, date: at(3) });
    await Transaction.create({ ...base, type: "expense", amount: 800, reviewStatus: "voided", date: at(3) });
    await Transaction.create({ ...base, type: "expense", amount: 900, isRecurring: true, installmentStatus: "upcoming", date: at(4) });
    await Transaction.create({ user: otherUserId, account: theirs._id, type: "expense", amount: 111, category: "x", date: at(2) });

    const res = await exportCsv();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-export-rows")).toBe("2");
    expect(res.headers.get("x-export-truncated")).toBe("false");
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toBe("date,type,amount,currency,category,subcategory,description,account,note,tags,source");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-10-01,income,0.05,INR,food,,,Bank,,,manual");
    expect(lines[2]).toBe('2026-10-02,expense,1250.50,INR,food,,"\'=HYPERLINK(""x"")",Bank,"said ""hi"", ok",a;b,manual');
    expect(lines.join("\n")).not.toContain("111");
  });

  it("export filters by account and dates, and refuses bad ones", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const other = await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0, currency: "INR" });
    const at = (d: number) => new Date(Date.UTC(2026, 9, d, 6, 0, 0));
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 100, category: "a", date: at(1) });
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 200, category: "a", date: at(10) });
    await Transaction.create({ user: userId, account: other._id, type: "expense", amount: 300, category: "a", date: at(10) });
    const ranged = await exportCsv(`?accountId=${accountId}&dateFrom=2026-10-05&dateTo=2026-10-10`);
    expect(ranged.headers.get("x-export-rows")).toBe("1");
    expect(await ranged.text()).toContain("2.00");
    const bounds = await exportCsv("?dateFrom=2026-10-01&dateTo=2026-10-01");
    expect(bounds.headers.get("x-export-rows")).toBe("1");
    expect((await exportCsv("?dateFrom=yesterday")).status).toBe(400);
    expect((await exportCsv("?dateTo=2026-02-31")).status).toBe(400);
    expect((await exportCsv("?accountId=nope")).status).toBe(400);
  });

  it("an export imports back into another account", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const at = (d: number) => new Date(Date.UTC(2026, 9, d, 6, 0, 0));
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 125050, category: "food", description: "Dinner, with friends", tags: ["x", "y"], date: at(2) });
    await Transaction.create({ user: userId, account: accountId, type: "income", amount: 99900, category: "salary", date: at(3) });
    const csv = await (await exportCsv()).text();
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    const res = await commit({ csv, accountId: fresh._id.toString() });
    expect((await res.json()).data).toMatchObject({ imported: 2, invalidCount: 0 });
    const rows = await Transaction.find({ account: fresh._id }).sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.type, r.amount, r.category, r.description ?? "", r.tags])).toEqual([
      ["expense", 125050, "food", "Dinner, with friends", ["x", "y"]],
      ["income", 99900, "salary", "", []],
    ]);
  });

  async function setUpAlerts() {
    const { default: Budget } = await import("@/models/Budget");
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    const { default: Goal } = await import("@/models/Goal");
    const now = new Date();
    await Budget.create({ user: userId, category: "food", month: now.getMonth() + 1, year: now.getFullYear(), limitAmount: 100000, alertAt: 80 });
    await SpendLimit.create({ user: userId, dailyAmount: 100000, weeklyAmount: 100000, alertAt: 80 });
    const goal = await Goal.create({ user: userId, name: "Trip", targetAmount: 10000000, roundUpEnabled: true, roundUpTo: 100 });
    return goal._id.toString();
  }
  async function settle() {
    // The alerts and the round-up run after the write returns.
    await new Promise((r) => setTimeout(r, 300));
  }
  const todayKey = async () => (await import("@/lib/spend-limit-time")).localDateKey(new Date(), "Asia/Kolkata");

  it("a day whose midnight is skipped still imports on its own date and re-imports as a duplicate", async () => {
    const { default: User } = await import("@/models/User");
    const { default: Transaction } = await import("@/models/Transaction");
    await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "America/Santiago" } });
    const csv = "Date,Description,Amount\n2026-09-06,Brunch,-80.00\n2026-09-05,Dinner,-90.00\n2026-09-07,Lunch,-70.00";
    await commit({ csv });
    const rows = await Transaction.find({ user: userId }).sort({ date: 1 }).lean<{ date: Date; description: string }[]>();
    expect(rows.map((r) => [r.description, r.date.toISOString()])).toEqual([
      ["Dinner", "2026-09-05T04:00:00.000Z"],
      ["Brunch", "2026-09-06T04:00:00.000Z"],
      ["Lunch", "2026-09-07T03:00:00.000Z"],
    ]);
    const text = (await (await exportCsv()).text()).split("\n");
    expect(text.slice(1).map((l) => l.slice(0, 10))).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect((await (await preview({ csv })).json()).data).toMatchObject({ duplicateCount: 3, importCount: 0 });
    const ranged = await exportCsv("?dateFrom=2026-09-06&dateTo=2026-09-06");
    expect(ranged.headers.get("x-export-rows")).toBe("1");
  });

  it("an export-defanged cell that starts with a quote comes back exactly", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const base = { user: userId, account: accountId, type: "expense", amount: 100, category: "food" };
    const values = ["'-5", "''x", "'", "'plain", "=1+1", "-5", "x'y"];
    for (const [i, description] of values.entries()) {
      await Transaction.create({ ...base, description, note: description, date: new Date(Date.UTC(2026, 9, i + 1, 6)) });
    }
    const csv = await (await exportCsv()).text();
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    await commit({ csv, accountId: fresh._id.toString() });
    const rows = await Transaction.find({ account: fresh._id }).sort({ date: 1 }).lean();
    expect(rows.map((r) => r.description)).toEqual(values);
    expect(rows.map((r) => r.note)).toEqual(values);
  });

  it("a run that outlived its lock does not delete the lock another run now holds", async () => {
    const { default: ImportLock } = await import("@/models/ImportLock");
    const { default: Transaction } = await import("@/models/Transaction");
    const spy = vi.spyOn(Transaction, "create");
    let swapped = false;
    spy.mockImplementation(async function (this: unknown, ...args: unknown[]) {
      if (!swapped) {
        swapped = true;
        // The first run's lock expired and a second run took its own.
        await ImportLock.deleteMany({ user: userId });
        await ImportLock.create({ user: userId, account: accountId, expiresAt: new Date(Date.now() + 60_000) });
      }
      spy.mockRestore();
      return (Transaction.create as unknown as (...a: unknown[]) => Promise<unknown>).apply(Transaction, args);
    } as never);
    const res = await commit({ csv: "Date,Amount\n2026-10-05,-5.00" });
    expect(res.status).toBe(201);
    expect(swapped).toBe(true);
    expect(await ImportLock.countDocuments({ user: userId, account: accountId })).toBe(1);
  });

  it("control: a manual expense over the budget and limit does alert and round up", async () => {
    const { createTransaction } = await import("@/lib/transaction-service");
    const { default: Notification } = await import("@/models/Notification");
    const { default: Goal } = await import("@/models/Goal");
    const goalId = await setUpAlerts();
    await createTransaction({
      userId, actor: { id: userId, name: "EI", email: "e@x.com", role: "user" }, accountId, type: "expense", amount: 150050, currency: "INR",
      category: "food", tags: [], isRecurring: false, date: new Date().toISOString(),
    });
    await settle();
    expect(await Notification.countDocuments({ user: userId, type: "budget_alert" })).toBeGreaterThan(0);
    expect((await Goal.findById(goalId))!.savedAmount).toBe(50);
  });

  it("an import over the budget and limit raises no alert and no round-up", async () => {
    const { default: Notification } = await import("@/models/Notification");
    const { default: Goal } = await import("@/models/Goal");
    const goalId = await setUpAlerts();
    const res = await commit({ csv: `Date,Amount,Category\n${await todayKey()},-1500.50,food` });
    expect((await res.json()).data.imported).toBe(1);
    await settle();
    expect(await Notification.countDocuments({ user: userId })).toBe(0);
    expect((await Goal.findById(goalId))!.savedAmount).toBe(0);
  });

  it("categorise rules never rewrite an imported row", async () => {
    const { default: Rule } = await import("@/models/Rule");
    const { default: Transaction } = await import("@/models/Transaction");
    await Rule.create({ user: userId, field: "merchant", op: "contains", value: "swiggy", valueKey: "swiggy", category: "dining", merchantName: "Swiggy Ltd", tags: ["auto"] });
    const csv = "Date,Narration,Amount,Category\n05/10/2026,UPI/SWIGGY/123,-200,other";
    const data = (await (await preview({ csv })).json()).data;
    expect(data.sample[0]).toMatchObject({ description: "UPI/SWIGGY/123", category: "other", tags: [] });
    await commit({ csv });
    const row = await Transaction.findOne({ user: userId }).lean();
    expect(row).toMatchObject({ description: "UPI/SWIGGY/123", category: "other", tags: [] });
  });

  it("a comma amount is read as thousands or refused, never as a decimal comma", async () => {
    const data = (await (await preview({ csv: 'Date,Amount\n05/10/2026,"1,234.50"\n06/10/2026,"12,50"\n07/10/2026,"1,23,456"' })).json()).data;
    expect(data.sample.map((s: { amount: number }) => s.amount)).toEqual([123450, 12345600]);
    expect(data.errors).toEqual([{ row: 2, field: "amount", message: expect.stringContaining("Cannot read the amount") }]);
  });

  it("a date lands on the user's own day in a zone ahead of UTC and re-imports as a duplicate", async () => {
    const { default: User } = await import("@/models/User");
    const { default: Transaction } = await import("@/models/Transaction");
    await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "Pacific/Auckland" } });
    const csv = "Date,Description,Amount\n2026-10-05,Lunch,-50.00";
    await commit({ csv });
    const row = await Transaction.findOne({ user: userId }).lean<{ date: Date }>();
    // Auckland is UTC+13 in October: its midnight is 11:00 UTC the day before.
    expect(row!.date.toISOString()).toBe("2026-10-04T11:00:00.000Z");
    const text = await (await exportCsv()).text();
    expect(text.split("\n")[1]).toMatch(/^2026-10-05,expense,50\.00,/);
    expect((await (await preview({ csv })).json()).data).toMatchObject({ duplicateCount: 1, importCount: 0 });
    // The same day entered by hand at 23:30 Auckland time is also a duplicate.
    await Transaction.create({ user: userId, account: accountId, type: "income", amount: 700, category: "x", date: new Date("2026-10-06T10:30:00Z") });
    expect((await (await preview({ csv: "Date,Amount\n2026-10-06,7.00" })).json()).data.duplicateCount).toBe(1);
  });

  it("export and import agree with a quote character and a defanged formula in the text", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const base = { user: userId, account: accountId, type: "expense", amount: 100, category: "food" };
    await Transaction.create({ ...base, description: "=1+1", note: "-5 off", date: new Date("2026-10-02T06:00:00Z") });
    await Transaction.create({ ...base, description: "'quoted", note: "@home", date: new Date("2026-10-03T06:00:00Z") });
    await Transaction.create({ ...base, description: "+91 shop", date: new Date("2026-10-04T06:00:00Z") });
    const csv = await (await exportCsv()).text();
    expect(csv).toContain("'=1+1");
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    await commit({ csv, accountId: fresh._id.toString() });
    const rows = await Transaction.find({ account: fresh._id }).sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.description, r.note ?? ""])).toEqual([["=1+1", "-5 off"], ["'quoted", "@home"], ["+91 shop", ""]]);
  });

  it("export leaves out transfers and every unfinished planned instalment, and so does the duplicate check", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const wallet = await Account.create({ user: userId, name: "Wallet", type: "cash", balance: 0, currency: "INR" });
    const day = new Date("2026-10-05T06:00:00Z");
    const base = { user: userId, account: accountId, category: "bills", amount: 3300, date: day };
    await Transaction.create({ ...base, type: "transfer", transferTo: wallet._id });
    for (const installmentStatus of ["upcoming", "skipped", "overdue"]) {
      await Transaction.create({ ...base, type: "expense", isRecurring: true, installmentStatus });
    }
    await Transaction.create({ ...base, type: "expense", isRecurring: true, installmentStatus: "paid" });
    const res = await exportCsv();
    expect(res.headers.get("x-export-rows")).toBe("1");
    const only = await exportCsv(`?accountId=${wallet._id}`);
    expect(only.headers.get("x-export-rows")).toBe("0");
    // Only the paid instalment counts as an existing row.
    const data = (await (await preview({ csv: "Date,Amount\n2026-10-05,-33.00\n2026-10-05,-33.00" })).json()).data;
    expect(data).toMatchObject({ duplicateCount: 1, importCount: 1 });
  });

  it("warns about dates that read two ways, and commit asks for the order", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const guessed = (await (await preview({ csv: statement })).json()).data;
    expect(guessed.ambiguousDates).toBe(true);
    expect(guessed.warnings).toHaveLength(1);
    expect(guessed.warnings[0]).toContain("dateOrder");
    const told = (await (await preview({ csv: statement, dateOrder: "mdy" })).json()).data;
    expect(told.ambiguousDates).toBe(true);
    expect(told.warnings).toEqual([]);
    expect(told.sample[0].date).toBe("2026-01-10");

    const refused = await commit({ csv: statement, dateOrder: undefined });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.details.code).toBe("NEEDS_DATE_ORDER");
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);

    // Not ambiguous (13 cannot be a month): no order needed, no warning.
    const clear = "Date,Amount\n13/10/2026,-5";
    expect((await (await preview({ csv: clear })).json()).data).toMatchObject({ ambiguousDates: false, warnings: [] });
    expect((await commit({ csv: clear, dateOrder: undefined })).status).toBe(201);
  });

  it("refuses to check duplicates when the account has more rows in range than the cap", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { EXISTING_LIMIT } = await import("@/lib/transaction-import");
    const date = new Date("2026-10-05T06:00:00Z");
    const docs = Array.from({ length: EXISTING_LIMIT + 1 }, () => ({ user: userId, account: accountId, type: "expense", amount: 1, category: "x", date }));
    await Transaction.insertMany(docs, { ordered: false });
    const csv = "Date,Amount\n2026-10-05,-9.00";
    const res = await preview({ csv });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.code).toBe("TOO_MANY_EXISTING");
    expect((await commit({ csv })).status).toBe(400);
    expect(await Transaction.countDocuments({ user: userId, source: "import" })).toBe(0);
  }, 60_000);

  it("two commits with different keys do not both insert", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const [a, b] = await Promise.all([commit({ csv: statement }, { "idempotency-key": "race-a" }), commit({ csv: statement }, { "idempotency-key": "race-b" })]);
    expect([a.status, b.status].sort()).toSatisfy((st: number[]) => st[0] === 201 && (st[1] === 201 || st[1] === 409));
    expect(await Transaction.countDocuments({ user: userId })).toBe(3);
    // A retry under a third key adds nothing either.
    const again = await commit({ csv: statement }, { "idempotency-key": "race-c" });
    expect((await again.json()).data.imported).toBe(0);
    expect(await Transaction.countDocuments({ user: userId })).toBe(3);
  });

  it("a held lock answers 409 without burning the key, and a later retry works", async () => {
    const { default: ImportLock } = await import("@/models/ImportLock");
    const { default: IdempotencyRecord } = await import("@/models/IdempotencyRecord");
    await ImportLock.create({ user: userId, account: accountId, expiresAt: new Date(Date.now() + 60_000) });
    const blocked = await commit({ csv: statement }, { "idempotency-key": "held" });
    expect(blocked.status).toBe(409);
    expect(await IdempotencyRecord.countDocuments({ userId, key: "held" })).toBe(0);
    await ImportLock.deleteMany({});
    const ok = await commit({ csv: statement }, { "idempotency-key": "held" });
    expect(ok.status).toBe(201);
    expect(await ImportLock.countDocuments({})).toBe(0);
  });

  it("keeps the pending record and the result when only recording the result fails", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    const { default: IdempotencyRecord } = await import("@/models/IdempotencyRecord");
    let writes = 0;
    const spy = vi.spyOn(IdempotencyRecord, "findOneAndUpdate").mockImplementation((() => {
      throw new Error("db hiccup");
    }) as never);
    const run = () =>
      withIdempotency({ userId, endpoint: "t2", key: "ck", body: { a: 1 }, execute: async () => { writes += 1; return { status: 201, body: { ok: true } }; } });
    const first = await run();
    spy.mockRestore();
    expect(first).toEqual({ kind: "executed", status: 201, body: { ok: true } });
    // The record is still there (pending), so a retry waits instead of writing again.
    expect(await IdempotencyRecord.countDocuments({ userId, key: "ck", status: "pending" })).toBe(1);
    const retry = await run();
    expect(retry).toEqual({ kind: "conflict", reason: "in_progress" });
    expect(writes).toBe(1);
    // A failing execute still frees the key.
    await expect(withIdempotency({ userId, endpoint: "t2", key: "bad", body: { a: 1 }, execute: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
    expect(await IdempotencyRecord.countDocuments({ userId, key: "bad" })).toBe(0);
  });

  it("keeps the pending key and lock at least twice the commit route's run time", async () => {
    const { maxDuration } = await import("@/app/api/integrations/import/commit/route");
    const { maxDuration: previewDuration } = await import("@/app/api/integrations/import/preview/route");
    const { IMPORT_PENDING_TTL_SECONDS } = await import("@/lib/transaction-import");
    expect(IMPORT_PENDING_TTL_SECONDS).toBeGreaterThanOrEqual(2 * maxDuration);
    // A preview does the same reading as a commit, so it gets the same limit.
    expect(previewDuration).toBe(maxDuration);
  });

  it("the pending idempotency record expires in minutes, the finished one keeps the full time", async () => {
    const { withIdempotency } = await import("@/lib/integrations/idempotency");
    const { default: IdempotencyRecord } = await import("@/models/IdempotencyRecord");
    let pendingLeft = 0;
    await withIdempotency({
      userId, endpoint: "t", key: "pk", body: { a: 1 }, pendingTtlSeconds: 120,
      execute: async () => {
        const r = await IdempotencyRecord.findOne({ userId, key: "pk" }).lean<{ expiresAt: Date }>();
        pendingLeft = r!.expiresAt.getTime() - Date.now();
        return { status: 200, body: {} };
      },
    });
    expect(pendingLeft).toBeLessThanOrEqual(120_000);
    expect(pendingLeft).toBeGreaterThan(100_000);
    const done = await IdempotencyRecord.findOne({ userId, key: "pk" }).lean<{ expiresAt: Date }>();
    expect(done!.expiresAt.getTime() - Date.now()).toBeGreaterThan(3_600_000);
  });

  it("a file at the row cap commits well inside the function limit; one row over is refused", async () => {
    const { IMPORT_MAX_ROWS } = await import("@/lib/csv-import");
    const { default: Transaction } = await import("@/models/Transaction");
    const lines = ["Date,Narration,Amount"];
    for (let i = 0; i < IMPORT_MAX_ROWS; i += 1) lines.push(`2026-09-${String((i % 28) + 1).padStart(2, "0")},Shop ${i},-${10 + i}.00`);
    const start = Date.now();
    const res = await commit({ csv: lines.join("\n") });
    const ms = Date.now() - start;
    expect((await res.json()).data.imported).toBe(IMPORT_MAX_ROWS);
    expect(await Transaction.countDocuments({ user: userId })).toBe(IMPORT_MAX_ROWS);
    // The route allows 60 s; leave a wide margin for a slower database.
    expect(ms).toBeLessThan(40_000);
    lines.push("2026-09-01,One too many,-1.00");
    const over = await preview({ csv: lines.join("\n") });
    expect(over.status).toBe(400);
    expect((await over.json()).error.details.code).toBe("INVALID_CSV");
  }, 60_000);

  async function setBase(code: string) {
    const { default: User } = await import("@/models/User");
    await User.updateOne({ _id: userId }, { $set: { "preferences.currency": code } });
  }
  const baseLockedOf = async () => {
    const { default: User } = await import("@/models/User");
    return Boolean((await User.findById(userId).select("baseLocked").lean<{ baseLocked?: boolean }>())?.baseLocked);
  };

  it("imports into an account labelled with another currency, in the base currency", async () => {
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    await setBase("USD");
    await Account.updateOne({ _id: accountId }, { $set: { currency: "EUR" } });
    const csv = "Date,Description,Amount\n2026-10-05,Coffee,-12.50\n2026-10-06,Pay,300.00";
    const res = await commit({ csv });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ imported: 2, failed: 0, invalidCount: 0, baseCurrency: "USD", account: { currency: "EUR" } });
    const rows = await Transaction.find({ user: userId }).sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.amount, r.currency])).toEqual([[1250, "USD"], [30000, "USD"]]);
    expect(rows.every((r) => r.source === "import")).toBe(true);
    const text = (await (await exportCsv()).text()).split("\n");
    expect(text[1]).toContain(",12.50,USD,");
  });

  it("preview does not pin the base currency; the first import that writes does, and one that writes nothing does not", async () => {
    await setBase("USD");
    const csv = "Date,Amount\n2026-10-05,-5.00";
    const p = await preview({ csv });
    expect((await p.json()).data).toMatchObject({ baseCurrency: "USD", minorExponent: 2 });
    expect(await baseLockedOf()).toBe(false);
    // Nothing valid to write: no lock.
    expect((await commit({ csv: "Date,Amount\nnope,1" })).status).toBe(201);
    expect(await baseLockedOf()).toBe(false);
    expect((await commit({ csv })).status).toBe(201);
    expect(await baseLockedOf()).toBe(true);
    const { setBaseCurrency } = await import("@/lib/base-currency");
    await expect(setBaseCurrency(userId, "EUR")).rejects.toMatchObject({ code: "HAS_MONEY_DATA" });
  });

  it("reads, writes, exports and de-duplicates in the minor units of USD (2 decimals)", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    await setBase("USD");
    const csv = "Date,Description,Amount\n2026-10-05,Lunch,-12.50\n2026-10-06,Refund,3.00";
    const data = (await (await preview({ csv })).json()).data;
    expect(data).toMatchObject({ baseCurrency: "USD", validCount: 2, invalidCount: 0, expenseTotal: 1250, incomeTotal: 300 });
    expect((await commit({ csv })).status).toBe(201);
    const rows = await Transaction.find({ user: userId }).sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.amount, r.currency])).toEqual([[1250, "USD"], [300, "USD"]]);
    const text = (await (await exportCsv()).text()).split("\n");
    const cells = text[1].split(",");
    expect(cells[2]).toBe("12.50");
    expect(cells[3]).toBe("USD");
    // The export reads back as the same rows: a duplicate here, and exact in a fresh account.
    expect((await (await preview({ csv: text.join("\n") })).json()).data).toMatchObject({ duplicateCount: 2, importCount: 0 });
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    await commit({ csv: text.join("\n"), accountId: fresh._id.toString() });
    const back = await Transaction.find({ account: fresh._id }).sort({ date: 1 }).lean();
    expect(back.map((r) => [r.type, r.amount])).toEqual([["expense", 1250], ["income", 300]]);
  });

  // A JPY or KWD base cannot be selected or written to (two-decimal bases only
  // for now), so these check the pure reading and the preview maths, which
  // write nothing, and that a commit is refused.
  it.each([
    { base: "JPY", exponent: 0, cell: "1250", income: "300" },
    { base: "KWD", exponent: 3, cell: "1.250", income: "0.300" },
  ])("previews in the minor units of $base ($exponent decimals) and refuses to import into it", async ({ base, exponent, cell, income }) => {
    const { default: Transaction } = await import("@/models/Transaction");
    await setBase(base);
    const csv = `Date,Description,Amount\n2026-10-05,Lunch,-${cell}\n2026-10-06,Refund,${income}`;
    const data = (await (await preview({ csv })).json()).data;
    expect(data).toMatchObject({ baseCurrency: base, minorExponent: exponent, validCount: 2, invalidCount: 0, expenseTotal: 1250, incomeTotal: 300 });

    const res = await commit({ csv });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.details.code).toBe("UNSUPPORTED_BASE_CURRENCY");
    expect(error.message).toMatch(/Only currencies with two decimals/);
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
    expect(await baseLockedOf()).toBe(false);
  });

  it("refuses digits the currency does not have, but takes trailing zeros", async () => {
    const { parseAmountCell } = await import("@/lib/csv-import");
    expect(parseAmountCell("1000.00", 0)).toBe(1000);
    expect(parseAmountCell("12.5", 0)).toBeNull();
    expect(parseAmountCell("1,250", 0)).toBe(1250);
    expect(parseAmountCell("1.2345", 3)).toBeNull();
    expect(parseAmountCell("1.2500", 3)).toBe(1250);
    expect(parseAmountCell("1.5", 3)).toBe(1500);
    expect(parseAmountCell("1.234")).toBeNull();
    expect(parseAmountCell("12.50")).toBe(1250);
    expect(parseAmountCell("-5", 0)).toBe(-5);
  });

  it("formats minor units with the currency's own digits", async () => {
    const { majorUnits } = await import("@/lib/transaction-export");
    expect(majorUnits(125050)).toBe("1250.50");
    expect(majorUnits(5, 2)).toBe("0.05");
    expect(majorUnits(125050, 0)).toBe("125050");
    expect(majorUnits(-7, 0)).toBe("-7");
    expect(majorUnits(1250, 3)).toBe("1.250");
    expect(majorUnits(5, 3)).toBe("0.005");
  });

  it("writes plain numbers unquoted only in numeric columns, and defangs text everywhere else", async () => {
    const { toCsv } = await import("@/lib/csv");
    const row = { a: "-5.00", b: "1250.50", c: "125050", d: -7, e: "-5 off", f: "=1+1", g: "'-5", h: "-1e5", i: "-" };
    const cols = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const numeric = toCsv([row], cols, { numericColumns: ["a", "b", "c", "d"] });
    expect(numeric.split("\n")[1]).toBe("-5.00,1250.50,125050,-7,'-5 off,'=1+1,''-5,'-1e5,'-");
    // Without the option the same strings are text: only a real JS number stays a number.
    const text = toCsv([row], cols);
    expect(text.split("\n")[1]).toBe("'-5.00,1250.50,125050,-7,'-5 off,'=1+1,''-5,'-1e5,'-");
    // A numeric column does not make other strings numeric: a label is still defanged.
    expect(toCsv([{ n: "-abc", m: "-9.5" }], ["n", "m"], { numericColumns: ["m"] }).split("\n")[1]).toBe("'-abc,-9.5");
  });

  it("keeps description and note text as text through an export and an import", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const values = ["007", "1250", "-5", "-5.00", "0.50", "'-5", "=SUM(A1)"];
    const base = { user: userId, account: accountId, type: "expense", amount: 4500, category: "food" };
    for (const [i, v] of values.entries()) {
      await Transaction.create({ ...base, description: v, note: v, date: new Date(Date.UTC(2026, 9, i + 1, 6)) });
    }
    const csv = await (await exportCsv()).text();
    const lines = csv.split("\n").slice(1);
    // The amount column is a number; the text columns are text: a negative-looking one carries the quote.
    expect(lines[0]).toBe("2026-10-01,expense,45.00,INR,food,,007,Bank,007,,manual");
    expect(lines[1]).toBe("2026-10-02,expense,45.00,INR,food,,1250,Bank,1250,,manual");
    expect(lines[2]).toBe("2026-10-03,expense,45.00,INR,food,,'-5,Bank,'-5,,manual");
    expect(lines[3]).toBe("2026-10-04,expense,45.00,INR,food,,'-5.00,Bank,'-5.00,,manual");
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    expect((await commit({ csv, accountId: fresh._id.toString() })).status).toBe(201);
    const rows = await Transaction.find({ account: fresh._id }).sort({ date: 1 }).lean();
    expect(rows.map((r) => r.description)).toEqual(values);
    expect(rows.map((r) => r.note)).toEqual(values);
    expect(rows.every((r) => r.amount === 4500)).toBe(true);
  });

  it("the budgets and web transactions exports keep amounts numeric and descriptions text", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    sessionUser.current = { id: userId, name: "EI", email: "e@x.com", role: "user" };
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 4500, category: "food", description: "-5", note: "007", date: new Date("2026-10-05T06:00:00Z") });
    const { GET } = await import("@/app/api/transactions/route");
    const res = await GET(new NextRequest("http://localhost/api/transactions?format=csv"));
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toBe("date,type,category,subcategory,description,note,amount,currency,account,tags");
    expect(lines[1]).toBe("2026-10-05,expense,food,,'-5,007,45.00,INR,Bank,");
    sessionUser.current = null;
  });

  it("reads a negative amount written plain, defanged by an older export, or in debit and credit columns", async () => {
    const dated = (rows: string[]) => ["Date,Description,Amount", ...rows].join("\n");
    const { data } = await (await preview({ csv: dated(["2026-10-05,Plain,-5.00", "2026-10-06,Older,'-12.50", "2026-10-07,Income,300.00", "2026-10-08,Older income,'+40.00"]) })).json();
    expect(data.invalidCount).toBe(0);
    expect(data.sample.map((s: { type: string; amount: number }) => [s.type, s.amount])).toEqual([
      ["expense", 500], ["expense", 1250], ["income", 30000], ["income", 4000],
    ]);
    const dc = (await (await preview({ csv: "Date,Particulars,Debit,Credit\n2026-10-05,Rent,'-15000,\n2026-10-06,Refund,,'+300.50" })).json()).data;
    expect(dc.invalidCount).toBe(0);
    expect(dc.sample.map((s: { type: string; amount: number }) => [s.type, s.amount])).toEqual([["expense", 1500000], ["income", 30050]]);
    const typed = (await (await preview({ csv: "Date,Amount,Type\n2026-10-05,'-9.00,Debit", amountSign: "signed" })).json()).data;
    expect(typed.sample[0]).toMatchObject({ type: "expense", amount: 900 });
  });

  it("commits negative and positive rows from a plain and an older file, and they export and re-import", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const plain = "Date,Description,Amount\n2026-10-05,Coffee,-5.00\n2026-10-06,Pay,300.00";
    const older = "Date,Description,Amount\n2026-10-07,Tea,'-6.00\n2026-10-08,Gift,'+20.00";
    expect((await commit({ csv: plain })).status).toBe(201);
    expect((await commit({ csv: older })).status).toBe(201);
    const rows = await Transaction.find({ user: userId }).sort({ date: 1 }).lean();
    expect(rows.map((r) => [r.type, r.amount])).toEqual([["expense", 500], ["income", 30000], ["expense", 600], ["income", 2000]]);
    const exported = await (await exportCsv()).text();
    const fresh = await Account.create({ user: userId, name: "Fresh", type: "bank", balance: 0, currency: "INR" });
    const res = await commit({ csv: exported, accountId: fresh._id.toString() });
    expect((await res.json()).data).toMatchObject({ imported: 4, invalidCount: 0 });
  });

  it("starts every CSV download with a UTF-8 byte order mark that import ignores", async () => {
    const { csvResponse, CSV_BOM } = await import("@/lib/csv");
    const head = async (res: Response) => Array.from(new Uint8Array(await res.arrayBuffer()).slice(0, 3));
    expect(await head(csvResponse("a,b\n1,2", "x.csv"))).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM).toBe("\uFEFF");

    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 12345, category: "food", description: "Café ₹ मसाला", date: new Date("2026-10-05T06:00:00Z") });
    const res = await exportCsv();
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(res.headers.get("content-type")).toContain("utf-8");
    // The text itself decodes (a BOM is dropped by the decoder) and carries the non-ASCII intact.
    expect(await res.text()).toContain("Café ₹ मसाला");

    // The server's own parser takes a file that still has the mark, header and all.
    const withBom = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(withBom.charCodeAt(0)).toBe(0xfeff);
    const data = (await (await preview({ csv: withBom })).json()).data;
    expect(data).toMatchObject({ validCount: 1, invalidCount: 0, mapping: { date: "date", amount: "amount", description: "description" } });
    expect(data.sample[0]).toMatchObject({ description: "Café ₹ मसाला", amount: 12345 });
    const done = await commit({ csv: withBom, accountId, includeDuplicates: true });
    expect((await done.json()).data.imported).toBe(1);
  });

  it("every web CSV export goes through the same BOM", async () => {
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.create({ user: userId, account: accountId, type: "expense", amount: 100, category: "food", date: new Date() });
    // The browser's transactions export, with the signed-in user mocked above.
    sessionUser.current = { id: userId, name: "EI", email: "e@x.com", role: "user" };
    const { GET } = await import("@/app/api/transactions/route");
    const res = await GET(new NextRequest("http://localhost/api/transactions?format=csv"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    sessionUser.current = null;
    void Account;
  });
});

describe("import body size", () => {
  const KEY = "test-import-size-api-key";

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "Big", email: `big${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "p", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
  });

  async function send(route: "preview" | "commit", body: string, headers: Record<string, string> = {}) {
    const mod = await import(`@/app/api/integrations/import/${route}/route`);
    return mod.POST(
      new NextRequest(`http://localhost/api/integrations/import/${route}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": "size-key", ...headers },
        body,
      }),
      {}
    );
  }
  const valid = JSON.stringify({ accountId: "64b64b64b64b64b64b64b64b", csv: "Date,Amount\n2026-10-05,-5" });

  it("refuses a valid body whose declared length is over the cap, with the too-large message", async () => {
    for (const route of ["preview", "commit"] as const) {
      const res = await send(route, valid, { "content-length": "2000000" });
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(/too large/);
    }
  });

  it("refuses a declared length that is not a number", async () => {
    const res = await send("preview", valid, { "content-length": "lots" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/too large/);
  });

  it("counts the bytes actually sent, so a missing or false length cannot sneak a big body in", async () => {
    const big = JSON.stringify({ accountId: "64b64b64b64b64b64b64b64b", csv: "x".repeat(1_300_000) });
    const res = await send("preview", big, { "content-length": "100" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/too large/);
    const noHeader = await send("commit", big);
    expect(noHeader.status).toBe(400);
  });

  it("still reads a normal body and says so for bad JSON", async () => {
    const ok = await send("preview", valid);
    // Unknown account: past the size gate, into the service.
    expect(ok.status).toBe(404);
    const bad = await send("preview", "{nope");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/valid JSON/);
  });
});


// ── Multi-currency ─────────────────────────────────────────────────────────

describe("multi-currency", () => {
  const KEY = "test-multi-currency-api-key";
  let userId: string;
  let accountId: string;
  let n = 0;
  const providerCalls = { count: 0, mode: "ok" as "ok" | "down" | "bad" };

  function providerBody(base: string) {
    // 1 INR buys these; so 1 USD = 1/0.012 = 83.3333... INR.
    const perInr: Record<string, number> = { INR: 1, USD: 0.012, JPY: 1.8, KWD: 0.0037, EUR: 0.011 };
    const factor = base === "INR" ? 1 : 1 / perInr[base]!;
    const rates = Object.fromEntries(Object.entries(perInr).map(([k, v]) => [k, v * factor]));
    return { result: "success", base_code: base, time_last_update_unix: 1792800151, rates };
  }

  // A failed refresh is remembered for ten minutes; tests that bring the
  // provider back straight away forget it.
  async function forgetFailedAttempt() {
    const { default: ExchangeRate } = await import("@/models/ExchangeRate");
    await ExchangeRate.updateMany({}, { $unset: { lastAttemptAt: 1 } });
  }

  async function makeUser(prefs: Record<string, unknown> = {}) {
    const { default: User } = await import("@/models/User");
    return User.create({ name: "FX", email: `fx${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true, ...prefs });
  }

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    providerCalls.count = 0;
    providerCalls.mode = "ok";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        providerCalls.count += 1;
        if (providerCalls.mode === "down") throw new Error("network down");
        if (providerCalls.mode === "bad") return new Response("nope", { status: 500 });
        return new Response(JSON.stringify(providerBody(String(url).split("/").pop()!)), { status: 200 });
      })
    );
    const { default: Account } = await import("@/models/Account");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await makeUser();
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    // An empty account: a balance would count as money data and pin the base currency.
    const account = await Account.create({ user: user._id, name: "Card", type: "bank", balance: 0, currency: "INR" });
    userId = user._id.toString();
    accountId = account._id.toString();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `fx-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/transactions/route");
    return POST(
      req("transactions", "POST", { accountId, type: "expense", category: "Travel", date: "2026-10-20T00:00:00.000Z", ...body }, headers),
      {}
    );
  }
  async function baseOfUser() {
    const { getBaseCurrency } = await import("@/lib/base-currency");
    return getBaseCurrency(userId);
  }

  it("converts a foreign expense, keeps the original beside it and moves the balance by the base amount", async () => {
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const res = await post({ originalAmount: 1234, originalCurrency: "USD" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    // 12.34 USD at 83.3333333333 INR = 1028.33 INR
    expect(data).toMatchObject({
      amount: 102833,
      currency: "INR",
      originalAmount: 1234,
      originalCurrency: "USD",
      originalExponent: 2,
      rate: 83.33333333,
      rateSource: "provider",
    });
    expect(new Date(data.rateDate).toISOString()).toBe("2026-10-24T00:02:31.000Z");
    expect((await Account.findById(accountId))!.balance).toBe(-102833);
    const stored = await Transaction.findById(data.id).lean<{ amount: number; originalCurrency: string }>();
    expect(stored).toMatchObject({ amount: 102833, originalCurrency: "USD" });
  });

  it("keeps a client rate near the provider's, marks it as the client's, and leaves rateDate empty", async () => {
    const res = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.55 });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ amount: 55000, rate: 0.55, originalExponent: 0, rateSource: "client", rateDate: null });
  });

  it("refuses a client rate more than 20% from the provider's, but takes one when no rate is known", async () => {
    const far = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.9 });
    expect(far.status).toBe(400);
    expect((await far.json()).error.message).toMatch(/20% away/);
    expect((await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.43 })).status).toBe(400); // more than 20% under
    expect((await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.66 })).status).toBe(201); // within 20% above

    const { default: ExchangeRate } = await import("@/models/ExchangeRate");
    await ExchangeRate.deleteMany({});
    providerCalls.mode = "down";
    const alone = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.9 });
    expect(alone.status).toBe(201);
    expect((await alone.json()).data).toMatchObject({ rateSource: "client", amount: 90000 });
  });

  it("handles three-digit currencies", async () => {
    const res = await post({ originalAmount: 1500, originalCurrency: "KWD" });
    expect((await res.json()).data).toMatchObject({ originalExponent: 3, amount: 40541 });
  });

  it("a plain request is unchanged and has no original fields", async () => {
    const res = await post({ amount: 2500, currency: "INR" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ amount: 2500, currency: "INR", originalAmount: null, originalCurrency: null, rate: null, rateSource: null });
    expect((await post({ amount: 2500 })).status).toBe(201);
    expect(providerCalls.count).toBe(0);
  });

  it("a plain amount in another currency is refused with advice, not stored as the base", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const res = await post({ amount: 2500, currency: "USD" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/originalAmount and originalCurrency/);
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
  });

  it("an original in the base currency is just a plain amount", async () => {
    const res = await post({ originalAmount: 4200, originalCurrency: "INR" });
    expect((await res.json()).data).toMatchObject({ amount: 4200, originalAmount: null, originalCurrency: null });
  });

  it("rejects bad foreign bodies and over-large amounts", async () => {
    expect((await post({ originalAmount: 100 })).status).toBe(400); // currency missing
    expect((await post({ originalCurrency: "USD" })).status).toBe(400); // amount missing
    expect((await post({ originalAmount: 100, originalCurrency: "XYZ" })).status).toBe(400);
    expect((await post({ originalAmount: 100, originalCurrency: "usd" })).status).toBe(400);
    expect((await post({ originalAmount: 100.5, originalCurrency: "USD" })).status).toBe(400);
    expect((await post({ originalAmount: 0, originalCurrency: "USD" })).status).toBe(400);
    expect((await post({ originalAmount: 1e15, originalCurrency: "USD" })).status).toBe(400);
    expect((await post({ amount: 2e13 })).status).toBe(400); // plain amount over the cap
    expect((await post({ amount: 1e13 + 1 })).status).toBe(400);
    expect((await post({ originalAmount: 100, originalCurrency: "USD", amount: 8000 })).status).toBe(400);
    expect((await post({ originalAmount: 100, originalCurrency: "USD", rate: 0 })).status).toBe(400);
    expect((await post({ originalAmount: 100, originalCurrency: "USD", rate: -3 })).status).toBe(400);
    expect((await post({ originalAmount: 100, originalCurrency: "USD", rate: 1e10 })).status).toBe(400);
    expect((await post({ amount: 100, rate: 80 })).status).toBe(400); // rate without an original
    expect((await post({ originalAmount: 100, originalCurrency: "USD", isRecurring: true, recurrenceFrequency: "monthly" })).status).toBe(400);
    expect(
      (await post({ originalAmount: 100, originalCurrency: "USD", splits: [{ category: "a", amount: 50 }, { category: "b", amount: 50 }] })).status
    ).toBe(400);
    expect((await post({ type: "transfer", originalAmount: 100, originalCurrency: "USD", transferToId: accountId })).status).toBe(400);
    expect((await post({})).status).toBe(400); // neither amount nor original
    const { default: Transaction } = await import("@/models/Transaction");
    expect(await Transaction.countDocuments({ user: userId })).toBe(0);
  });

  it("a converted amount that rounds to nothing is a clear 400", async () => {
    providerCalls.mode = "down"; // no known rate, so the client's tiny rate is taken and converts to 0
    const res = await post({ originalAmount: 1, originalCurrency: "JPY", rate: 0.001 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/too small/);
  });

  it("falls back to the cached table when the provider is down, and says no when nothing is cached", async () => {
    providerCalls.mode = "down";
    const none = await post({ originalAmount: 1000, originalCurrency: "USD" });
    expect(none.status).toBe(400);
    expect((await none.json()).error.message).toMatch(/Send "rate"/);

    providerCalls.mode = "ok";
    await forgetFailedAttempt();
    expect((await post({ originalAmount: 1000, originalCurrency: "USD" })).status).toBe(201);
    // Age the cache past the refresh time, then take the provider down.
    const { default: ExchangeRate } = await import("@/models/ExchangeRate");
    await ExchangeRate.updateOne({ base: "INR" }, { $set: { fetchedAt: new Date(Date.now() - 3 * 86_400_000) } });
    providerCalls.mode = "bad";
    const stale = await post({ originalAmount: 1000, originalCurrency: "USD" });
    expect(stale.status).toBe(201);

    // Older than 30 days: too stale to trust.
    await ExchangeRate.updateOne({ base: "INR" }, { $set: { fetchedAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect((await post({ originalAmount: 1000, originalCurrency: "USD" })).status).toBe(400);
  });

  it("after a failed refresh the provider is left alone for ten minutes, so a dead provider does not slow every request", async () => {
    providerCalls.mode = "down";
    const { GET } = await import("@/app/api/integrations/currencies/route");
    await GET(req("currencies", "GET"), {});
    expect(providerCalls.count).toBe(1);
    await GET(req("currencies", "GET"), {});
    await post({ originalAmount: 1000, originalCurrency: "USD" });
    await GET(req("currencies", "GET"), {});
    expect(providerCalls.count).toBe(1);
    const { default: ExchangeRate } = await import("@/models/ExchangeRate");
    await ExchangeRate.updateOne({ base: "INR" }, { $set: { lastAttemptAt: new Date(Date.now() - 11 * 60_000) } });
    await GET(req("currencies", "GET"), {});
    expect(providerCalls.count).toBe(2);
  });

  it("a missing rate is not replayed: the same Idempotency-Key works once the provider is back", async () => {
    providerCalls.mode = "down";
    const first = await post({ originalAmount: 1000, originalCurrency: "USD" }, { "idempotency-key": "fx-retry" });
    expect(first.status).toBe(400);
    expect((await first.json()).error.details.errorCode).toBe("RATE_UNAVAILABLE");
    providerCalls.mode = "ok";
    await forgetFailedAttempt();
    const second = await post({ originalAmount: 1000, originalCurrency: "USD" }, { "idempotency-key": "fx-retry" });
    expect(second.status).toBe(201);
  });

  it("caches one table and refreshes it after a day", async () => {
    await post({ originalAmount: 100, originalCurrency: "USD" });
    await post({ originalAmount: 100, originalCurrency: "EUR" });
    expect(providerCalls.count).toBe(1);
    const { default: ExchangeRate } = await import("@/models/ExchangeRate");
    await ExchangeRate.updateOne({ base: "INR" }, { $set: { fetchedAt: new Date(Date.now() - 2 * 86_400_000) } });
    await post({ originalAmount: 100, originalCurrency: "USD" });
    expect(providerCalls.count).toBe(2);
  });

  it("replays the same Idempotency-Key without a second row", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const a = await post({ originalAmount: 1234, originalCurrency: "USD" }, { "idempotency-key": "fx-same" });
    const b = await post({ originalAmount: 1234, originalCurrency: "USD" }, { "idempotency-key": "fx-same" });
    expect((await a.json()).data.id).toBe((await b.json()).data.id);
    expect(await Transaction.countDocuments({ user: userId })).toBe(1);
  });

  it("the real stats, budget and list endpoints add up the base amount of a foreign row", async () => {
    const { default: Budget } = await import("@/models/Budget");
    await post({ originalAmount: 1234, originalCurrency: "USD" }); // 102833 paise
    await post({ amount: 50000 });
    await Budget.create({ user: userId, category: "Travel", month: 10, year: 2026, limitAmount: 500000 });

    const { GET: stats } = await import("@/app/api/integrations/stats/route");
    const s = await (await stats(req("stats?month=10&year=2026", "GET"), {})).json();
    expect(s.data.expense).toBe(102833 + 50000);

    const { GET: budgets } = await import("@/app/api/integrations/budgets/route");
    const b = await (await budgets(req("budgets?month=10&year=2026", "GET"), {})).json();
    const travel = (b.data as { category: string; spent: number }[]).find((x) => x.category === "Travel");
    expect(travel!.spent).toBe(102833 + 50000);

    const { GET: list } = await import("@/app/api/integrations/transactions/route");
    const rows = (await (await list(req("transactions", "GET"), {})).json()).data.data as { amount: number; originalCurrency?: string }[];
    expect(rows.find((r) => r.originalCurrency === "USD")).toMatchObject({ amount: 102833, originalAmount: 1234 });
  });

  describe("GET /currencies", () => {
    it("lists currencies, the base and rates in base units", async () => {
      const { GET } = await import("@/app/api/integrations/currencies/route");
      const res = await GET(req("currencies", "GET"), {});
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.base).toBe("INR");
      expect(data.canChangeBase).toBe(true);
      expect(data.stale).toBe(false);
      expect(data.rates.USD).toBe(83.33333333);
      expect(data.rates.INR).toBeUndefined();
      expect(data.currencies.find((c: { code: string }) => c.code === "JPY")).toMatchObject({ name: "Japanese Yen", exponent: 0 });
    });

    it("answers with no rates, not an error, when the provider is down", async () => {
      providerCalls.mode = "down";
      const { GET } = await import("@/app/api/integrations/currencies/route");
      const { data } = await (await GET(req("currencies", "GET"), {})).json();
      expect(data.rates).toEqual({});
      expect(data.rateDate).toBeNull();
      expect(data.currencies.length).toBeGreaterThan(10);
    });

    it("canChangeBase turns false once there is money data", async () => {
      const { GET } = await import("@/app/api/integrations/currencies/route");
      const { default: Account } = await import("@/models/Account");
      await Account.updateOne({ _id: accountId }, { $set: { balance: 500 } });
      expect((await (await GET(req("currencies", "GET"), {})).json()).data.canChangeBase).toBe(false);
    });
  });

  describe("the base currency is fixed once money rows exist", () => {
    const rawRows: Record<string, (user: unknown) => Promise<void>> = {
      "an account with a balance": async (user) => {
        const { default: Account } = await import("@/models/Account");
        await Account.collection.insertOne({ user, name: "Bank", type: "bank", balance: 100, currency: "INR" });
      },
      "an account with a credit limit": async (user) => {
        const { default: Account } = await import("@/models/Account");
        await Account.collection.insertOne({ user, name: "Card", type: "credit_card", balance: 0, currency: "INR", creditMeta: { creditLimit: 500000 } });
      },
      "an account with a low-cash line": async (user) => {
        const { default: Account } = await import("@/models/Account");
        await Account.collection.insertOne({ user, name: "Cash", type: "cash", balance: 0, currency: "INR", lowBalanceAt: 50000 });
      },
      "a transaction": async (user) => {
        const { default: Transaction } = await import("@/models/Transaction");
        await Transaction.collection.insertOne({ user, amount: 100, type: "expense", category: "x", date: new Date() });
      },
      "a budget": async (user) => {
        const { default: Budget } = await import("@/models/Budget");
        await Budget.collection.insertOne({ user, category: "x", month: 1, year: 2026, limitAmount: 100 });
      },
      "a goal": async (user) => {
        const { default: Goal } = await import("@/models/Goal");
        await Goal.collection.insertOne({ user, name: "g", targetAmount: 100 });
      },
      "a loan": async (user) => {
        const { default: Loan } = await import("@/models/Loan");
        await Loan.collection.insertOne({ user, counterparty: "x", principalAmount: 100 });
      },
      "a sinking fund": async (user) => {
        const { default: SinkingFund } = await import("@/models/SinkingFund");
        await SinkingFund.collection.insertOne({ user, name: "f", targetAmount: 100 });
      },
      "a manual asset": async (user) => {
        const { default: ManualAsset } = await import("@/models/ManualAsset");
        await ManualAsset.collection.insertOne({ user, name: "a", value: 100 });
      },
      "a spend limit": async (user) => {
        const { default: SpendLimit } = await import("@/models/SpendLimit");
        await SpendLimit.collection.insertOne({ user, dailyAmount: 100 });
      },
    };

    for (const [label, insert] of Object.entries(rawRows)) {
      it(`refuses a change with ${label}, even for a user from before the lock existed, and locks them`, async () => {
        const { setBaseCurrency, BaseCurrencyError } = await import("@/lib/base-currency");
        const { default: User } = await import("@/models/User");
        const user = await makeUser();
        await insert(user._id);
        await expect(setBaseCurrency(user._id.toString(), "USD")).rejects.toBeInstanceOf(BaseCurrencyError);
        await expect(setBaseCurrency(user._id.toString(), "USD")).rejects.toThrow(/fixed once/);
        const after = await User.findById(user._id).lean<{ baseLocked?: boolean; preferences?: { currency?: string } }>();
        expect(after!.baseLocked).toBe(true);
        expect(after!.preferences?.currency).toBe("INR");
      });
    }

    it("a user with nothing, or only empty accounts, may choose a base", async () => {
      const { setBaseCurrency } = await import("@/lib/base-currency");
      expect(await setBaseCurrency(userId, "USD")).toBe("USD");
      expect(await baseOfUser()).toBe("USD");
      expect(await setBaseCurrency(userId, "EUR")).toBe("EUR");
    });

    it("every writer of a base-unit amount locks the base first", async () => {
      const { default: User } = await import("@/models/User");
      const { createGoal } = await import("@/lib/goal-service");
      const { createBudget } = await import("@/lib/budget-service");
      const { createLoan } = await import("@/lib/loan-service");
      const { createSinkingFund } = await import("@/lib/sinking-fund-service");
      const { createManualAsset } = await import("@/lib/net-worth");
      const { updateSpendLimit } = await import("@/lib/spend-limit");
      const { createAccount } = await import("@/lib/account-service");
      const { createTransaction } = await import("@/lib/transaction-service");
      const locked = async (u: { _id: unknown }) => Boolean((await User.findById(u._id).lean<{ baseLocked?: boolean }>())!.baseLocked);
      const actorOf = (u: { _id: { toString(): string }; name: string; email: string }) => ({ id: u._id.toString(), name: u.name, email: u.email, role: "user" });
      const fresh = async () => {
        const u = await makeUser();
        return { u, id: u._id.toString(), actor: actorOf(u) };
      };

      let f = await fresh();
      expect(await locked(f.u)).toBe(false);
      await createGoal({ userId: f.id, actor: f.actor, name: "Trip", targetAmount: 1000, savedAmount: 0 } as never);
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await createBudget({ userId: f.id, actor: f.actor, category: "Food", month: 10, year: 2026, limitAmount: 1000 } as never);
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await createLoan({ userId: f.id, actor: f.actor, direction: "given", counterparty: "Sam", principalAmount: 1000, startDate: new Date().toISOString() } as never);
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await createSinkingFund({ userId: f.id, name: "Insurance", targetAmount: 1000, savedAmount: 0, dueDate: new Date(Date.now() + 90 * 86_400_000).toISOString() } as never);
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await createManualAsset(f.id, { name: "Gold", kind: "gold", value: 1000 } as never);
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await updateSpendLimit(f.id, { dailyAmount: 1000 });
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      await createAccount({ userId: f.id, actor: f.actor, name: "Empty", type: "bank", balance: 0, currency: "INR" });
      expect(await locked(f.u)).toBe(false);
      const acct = await createAccount({ userId: f.id, actor: f.actor, name: "Funded", type: "bank", balance: 500, currency: "INR" });
      expect(await locked(f.u)).toBe(true);

      f = await fresh();
      const own = await createAccount({ userId: f.id, actor: f.actor, name: "Empty", type: "bank", balance: 0, currency: "INR" });
      await createTransaction({
        userId: f.id, actor: f.actor, accountId: own._id.toString(), type: "expense", amount: 100, category: "x",
        tags: [], isRecurring: false, date: new Date().toISOString(),
      });
      expect(await locked(f.u)).toBe(true);
      void acct;
    });

    it("the first transaction wins a race with a base change: the change is refused, the base stays", async () => {
      const { setBaseCurrency, BaseCurrencyError } = await import("@/lib/base-currency");
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: User } = await import("@/models/User");
      // setBaseCurrency has just found no money rows when a transaction is created
      // (it locks the base). Replay that interleave deterministically.
      const realExists = Transaction.exists.bind(Transaction);
      let interleaved = false;
      vi.spyOn(Transaction, "exists").mockImplementation(((filter: unknown) => {
        const result = realExists(filter as never);
        const run = async () => {
          const found = await result;
          if (!interleaved) {
            interleaved = true;
            await post({ amount: 100 }); // creates the transaction and locks the base
          }
          return found;
        };
        return { then: (a: never, b: never) => run().then(a, b) } as never;
      }) as never);
      await expect(setBaseCurrency(userId, "USD")).rejects.toBeInstanceOf(BaseCurrencyError);
      expect(interleaved).toBe(true);
      const after = await User.findById(userId).lean<{ preferences?: { currency?: string }; baseLocked?: boolean }>();
      expect(after!.preferences?.currency).toBe("INR");
      expect(after!.baseLocked).toBe(true);
    });

    it("the other order: a base change that lands first is what the next transaction uses", async () => {
      const { setBaseCurrency } = await import("@/lib/base-currency");
      await setBaseCurrency(userId, "USD");
      const res = await post({ originalAmount: 100000, originalCurrency: "INR" });
      expect((await res.json()).data).toMatchObject({ currency: "USD", originalCurrency: "INR", amount: 1200 });
      await expect(setBaseCurrency(userId, "EUR")).rejects.toThrow(/fixed once/);
    });

    it("PATCH /currencies refuses with a clear message and needs an Idempotency-Key", async () => {
      const { PATCH } = await import("@/app/api/integrations/currencies/route");
      await post({ amount: 100 });
      const res = await PATCH(req("currencies", "PATCH", { base: "USD" }), {});
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(/fixed once/);
      expect((await PATCH(req("currencies", "PATCH", { base: "INR" }), {})).status).toBe(200);
      expect((await PATCH(req("currencies", "PATCH", { base: "XYZ" }), {})).status).toBe(400);
      expect((await PATCH(req("currencies", "PATCH", {}), {})).status).toBe(400);
      const bad = new NextRequest("http://localhost/api/integrations/currencies", {
        method: "PATCH",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ base: "USD" }),
      });
      expect((await PATCH(bad, {})).status).toBe(400);
    });

    it("PATCH /currencies changes the base for a user with nothing, then rates follow it", async () => {
      const { PATCH, GET } = await import("@/app/api/integrations/currencies/route");
      expect((await PATCH(req("currencies", "PATCH", { base: "USD" }), {})).status).toBe(200);
      const { data } = await (await GET(req("currencies", "GET"), {})).json();
      expect(data.base).toBe("USD");
      expect(data.rates.INR).toBeCloseTo(0.012, 6);
    });

    it("the browser preferences route follows the same rule and whitelist", async () => {
      const { PATCH } = await import("@/app/api/me/preferences/route");
      const call = (body: unknown) =>
        PATCH(new NextRequest("http://localhost/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }));
      sessionUser.current = { id: userId, name: "FX", email: "fx@x.com", role: "user" };
      expect((await call({ currency: "XYZ" })).status).toBe(400);
      expect((await call({ currency: "EUR" })).status).toBe(200);
      await post({ originalAmount: 100, originalCurrency: "USD", rate: 0.9 });
      expect((await call({ currency: "USD" })).status).toBe(400);
      expect((await call({ currency: "EUR", theme: "dark" })).status).toBe(200);
      sessionUser.current = null;
    });
  });

  describe("amounts are shown in the base currency, whatever label an account carries", () => {
    it("forecast, bills, cash, home and summary use the base currency", async () => {
      const { default: User } = await import("@/models/User");
      const { default: Account } = await import("@/models/Account");
      await User.updateOne({ _id: userId }, { $set: { "preferences.currency": "USD" } });
      await Account.updateOne({ _id: accountId }, { $set: { currency: "EUR", type: "cash", balance: 700 } });

      const { GET: forecast } = await import("@/app/api/integrations/forecast/route");
      expect((await (await forecast(req("forecast", "GET"), {})).json()).data.currency).toBe("USD");

      const { GET: cash } = await import("@/app/api/integrations/cash/route");
      expect((await (await cash(req("cash", "GET"), {})).json()).data.account.currency).toBe("USD");

      const { GET: home } = await import("@/app/api/integrations/home/route");
      const h = await (await home(req("home", "GET"), {})).json();
      expect(h.data.accounts.every((a: { currency: string }) => a.currency === "USD")).toBe(true);

      const { GET: summary } = await import("@/app/api/integrations/summary/route");
      const sm = await (await summary(req("summary", "GET"), {})).json();
      expect(sm.data.accounts.every((a: { currency: string }) => a.currency === "USD")).toBe(true);

      // The accounts list is the label itself.
      const { GET: accounts } = await import("@/app/api/integrations/accounts/route");
      const list = await (await accounts(req("accounts", "GET"), {})).json();
      expect(list.data[0].currency).toBe("EUR");
    });

    it("a card's bill is in the base currency", async () => {
      const { default: User } = await import("@/models/User");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      await User.updateOne({ _id: userId }, { $set: { "preferences.currency": "USD" } });
      await Account.updateOne({ _id: accountId }, { $set: { currency: "EUR" } });
      const { listUpcomingBills } = await import("@/lib/bills");
      await Transaction.create({
        user: userId, account: accountId, type: "expense", amount: 500, category: "Rent", date: new Date(Date.now() + 2 * 86_400_000),
        isRecurring: true, recurringId: new mongoose.Types.ObjectId(), installmentStatus: "upcoming", currency: "EUR",
      });
      const bills = await listUpcomingBills(userId, { days: 10 } as never);
      expect(bills.length).toBeGreaterThan(0);
      expect(bills.every((b: { currency: string }) => b.currency === "USD")).toBe(true);
    });
  });

  it("accounts take a supported currency and reject others", async () => {
    const { POST } = await import("@/app/api/integrations/accounts/route");
    const ok = await POST(req("accounts", "POST", { name: "Dollar card", type: "bank", currency: "USD" }), {});
    expect(ok.status).toBe(201);
    expect((await ok.json()).data.currency).toBe("USD");
    expect((await POST(req("accounts", "POST", { name: "Bad", type: "bank", currency: "ZZZ" }), {})).status).toBe(400);
  });


  describe("review fixes", () => {
    const actorOf = (u: { _id: { toString(): string }; name: string; email: string }) => ({ id: u._id.toString(), name: u.name, email: u.email, role: "user" });
    const lockedOf = async (id: unknown) => {
      const { default: User } = await import("@/models/User");
      return Boolean((await User.findById(id).lean<{ baseLocked?: boolean }>())!.baseLocked);
    };

    it("credit limits and low-cash lines are base-unit amounts: setting one locks the base", async () => {
      const { createAccount, updateAccount } = await import("@/lib/account-service");
      let u = await makeUser();
      await createAccount({ userId: String(u._id), actor: actorOf(u), name: "Card", type: "credit_card", balance: 0, currency: "INR", creditMeta: { creditLimit: 100000 } } as never);
      expect(await lockedOf(u._id)).toBe(true);

      u = await makeUser();
      const empty = await createAccount({ userId: String(u._id), actor: actorOf(u), name: "Empty", type: "cash", balance: 0, currency: "INR" });
      expect(await lockedOf(u._id)).toBe(false);
      await updateAccount({ userId: String(u._id), accountId: String(empty._id), actor: actorOf(u), name: "Renamed" });
      expect(await lockedOf(u._id)).toBe(false);
      await updateAccount({ userId: String(u._id), accountId: String(empty._id), actor: actorOf(u), lowBalanceAt: null });
      expect(await lockedOf(u._id)).toBe(false);
      await updateAccount({ userId: String(u._id), accountId: String(empty._id), actor: actorOf(u), lowBalanceAt: 50000 });
      expect(await lockedOf(u._id)).toBe(true);

      u = await makeUser();
      const card = await createAccount({ userId: String(u._id), actor: actorOf(u), name: "Card", type: "credit_card", balance: 0, currency: "INR" });
      await updateAccount({ userId: String(u._id), accountId: String(card._id), actor: actorOf(u), creditMeta: { creditLimit: 90000 } });
      expect(await lockedOf(u._id)).toBe(true);
    });

    it("a rejected write does not lock an empty user's base", async () => {
      const { setBaseCurrency } = await import("@/lib/base-currency");
      const { createLoan } = await import("@/lib/loan-service");
      const { createBudget } = await import("@/lib/budget-service");
      const missing = new mongoose.Types.ObjectId().toString();

      expect((await post({ amount: 100, currency: "USD" })).status).toBe(400); // wrong currency
      providerCalls.mode = "down";
      expect((await post({ originalAmount: 100, originalCurrency: "USD" })).status).toBe(400); // no rate
      expect((await post({ originalAmount: 1, originalCurrency: "JPY", rate: 0.001 })).status).toBe(400); // rounds to nothing
      expect((await post({ amount: 100, accountId: missing })).status).toBe(404); // no such account
      expect(await lockedOf(userId)).toBe(false);

      const { default: User } = await import("@/models/User");
      const u = await User.findById(userId);
      await expect(
        createLoan({ userId, actor: actorOf(u!), direction: "given", counterparty: "Sam", principalAmount: 1000, startDate: new Date().toISOString(), accountId: missing } as never)
      ).rejects.toThrow();
      expect(await lockedOf(userId)).toBe(false);

      await createBudget({ userId, actor: actorOf(u!), category: "Food", month: 10, year: 2026, limitAmount: 1000 } as never);
      expect(await lockedOf(userId)).toBe(true); // a real write locks
      await expect(setBaseCurrency(userId, "USD")).rejects.toThrow(/fixed once/);
    });

    it("a rejected write leaves the base changeable", async () => {
      const { setBaseCurrency } = await import("@/lib/base-currency");
      expect((await post({ amount: 100, currency: "USD" })).status).toBe(400);
      expect(await setBaseCurrency(userId, "USD")).toBe("USD");
    });

    it("once the base is locked a transaction makes no write to the user document", async () => {
      const { default: User } = await import("@/models/User");
      await post({ amount: 100 });
      expect(await lockedOf(userId)).toBe(true);
      const spy = vi.spyOn(User, "findOneAndUpdate");
      await post({ amount: 200 });
      await post({ originalAmount: 100, originalCurrency: "USD" });
      expect(spy).not.toHaveBeenCalled();
    });

    it("the base changing between the read and the lock redoes the conversion against the new base", async () => {
      const { default: User } = await import("@/models/User");
      const { createTransaction } = await import("@/lib/transaction-service");
      const u = await User.findById(userId);
      // After createTransaction has read the base (INR) but before it locks, switch it to USD.
      const realFind = User.findOneAndUpdate.bind(User);
      let switched = false;
      vi.spyOn(User, "findOneAndUpdate").mockImplementation(((filter: unknown, update: unknown, opts: unknown) => {
        if (!switched) {
          switched = true;
          return {
            lean: () =>
              User.updateOne({ _id: userId }, { $set: { "preferences.currency": "USD" } }).then(() =>
                realFind(filter as never, update as never, opts as never).lean()
              ),
          };
        }
        return realFind(filter as never, update as never, opts as never);
      }) as never);
      const result = await createTransaction({
        userId, actor: actorOf(u!), accountId, type: "expense", category: "Travel", tags: [], isRecurring: false,
        date: new Date().toISOString(), originalAmount: 100000, originalCurrency: "INR",
      });
      // Converted to USD (1000.00 INR is 12.00 USD), not booked as INR.
      expect(result.transaction).toMatchObject({ currency: "USD", amount: 1200, originalCurrency: "INR" });
      expect(await lockedOf(userId)).toBe(true);
    });

    it("if the redo after a base change is rejected, the base stays locked (it is not unlocked again)", async () => {
      const { default: User } = await import("@/models/User");
      const { default: Transaction } = await import("@/models/Transaction");
      const { createTransaction, TransactionServiceError } = await import("@/lib/transaction-service");
      const u = await User.findById(userId);
      const realFind = User.findOneAndUpdate.bind(User);
      let switched = false;
      vi.spyOn(User, "findOneAndUpdate").mockImplementation(((filter: unknown, update: unknown, opts: unknown) => {
        if (!switched) {
          switched = true;
          return {
            lean: () =>
              User.updateOne({ _id: userId }, { $set: { "preferences.currency": "USD" } }).then(() =>
                realFind(filter as never, update as never, opts as never).lean()
              ),
          };
        }
        return realFind(filter as never, update as never, opts as never);
      }) as never);
      providerCalls.mode = "down"; // no INR to USD rate is known for the redo
      await expect(
        createTransaction({
          userId, actor: actorOf(u!), accountId, type: "expense", category: "Travel", tags: [], isRecurring: false,
          date: new Date().toISOString(), originalAmount: 100000, originalCurrency: "INR",
        })
      ).rejects.toBeInstanceOf(TransactionServiceError);
      expect(await lockedOf(userId)).toBe(true);
      expect(await Transaction.countDocuments({ user: userId })).toBe(0);
    });

    it("a transfer in another currency is a 400 with advice, not a 404", async () => {
      const { default: Account } = await import("@/models/Account");
      const other = await Account.create({ user: userId, name: "Savings", type: "savings", balance: 0, currency: "INR" });
      const { POST } = await import("@/app/api/integrations/transfers/route");
      const call = (body: Record<string, unknown>) =>
        POST(req("transfers", "POST", { fromAccountId: accountId, toAccountId: String(other._id), amount: 1000, ...body }), {});
      const bad = await call({ currency: "USD" });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error.message).toMatch(/originalAmount and originalCurrency/);
      expect((await call({ currency: "INR" })).status).toBe(201);
      expect((await call({})).status).toBe(201);
      const missing = await call({ toAccountId: new mongoose.Types.ObjectId().toString() });
      expect(missing.status).toBe(404);
    });

    it("a client rate outside the band is not stored under the Idempotency-Key, but a deterministic error is", async () => {
      const far = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.9 }, { "idempotency-key": "fx-band" });
      expect(far.status).toBe(400);
      // Same key, different body: if the 400 had been stored this would be a 409.
      const retry = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.55 }, { "idempotency-key": "fx-band" });
      expect(retry.status).toBe(201);

      const { default: ExchangeRate } = await import("@/models/ExchangeRate");
      await ExchangeRate.deleteMany({});
      providerCalls.mode = "down";
      const tiny = await post({ originalAmount: 1, originalCurrency: "JPY", rate: 0.001 }, { "idempotency-key": "fx-tiny" });
      expect(tiny.status).toBe(400);
      const again = await post({ originalAmount: 1000, originalCurrency: "JPY", rate: 0.55 }, { "idempotency-key": "fx-tiny" });
      expect(again.status).toBe(409);
    });

    it("the amount of a foreign row cannot be corrected on its own", async () => {
      const { correctTransaction, ReconcileError } = await import("@/lib/reconcile/correct");
      const { default: User } = await import("@/models/User");
      const u = await User.findById(userId);
      const created = await (await post({ originalAmount: 1234, originalCurrency: "USD" })).json();
      const attempt = (changes: Record<string, unknown>) =>
        correctTransaction({ userId, transactionId: created.data.id, changes, reason: "wrong_amount", via: "mobile", actor: actorOf(u!) } as never);
      await expect(attempt({ amount: 5000 })).rejects.toBeInstanceOf(ReconcileError);
      await expect(attempt({ amount: 5000 })).rejects.toThrow(/fixed/);
      // Other fields still correct; the amount stays.
      await attempt({ category: "Hotels" });
      const { default: Transaction } = await import("@/models/Transaction");
      expect(await Transaction.findById(created.data.id).lean()).toMatchObject({ category: "Hotels", amount: 102833, originalAmount: 1234 });
    });

    describe("bank messages on a USD base", () => {
      // No bank reference in these, so a later copy can only be matched on amount, account and day.
      const NOTIF = "₹250 paid to Swiggy from A/c XX1234";
      const SMS = "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. Not you? Call 18002586161";
      const T0 = new Date("2026-09-26T06:30:00Z");

      async function setup() {
        const { default: Account } = await import("@/models/Account");
        const user = await makeUser({ preferences: { currency: "USD" } });
        const bank = await Account.create({ user: user._id, name: "HDFC", type: "bank", balance: 0, currency: "INR", smsLastFour: ["1234"] });
        return { user, bank, actor: actorOf(user) };
      }
      async function ingest(actor: ReturnType<typeof actorOf>, channel: "sms" | "notification" | "n8n", text: string, at: Date) {
        const { ingestCapture } = await import("@/lib/capture/ingest");
        return ingestCapture({ user: actor, channel, text, receivedAt: at, sender: channel === "sms" ? "VM-HDFCBK" : undefined });
      }
      async function live(userId: string) {
        const { default: Transaction } = await import("@/models/Transaction");
        return Transaction.find({ user: userId, isDeleted: { $ne: true } }).lean<Record<string, unknown>[]>();
      }

      it("after a correction, another copy of the same payment is still matched, not booked again", async () => {
        const { actor } = await setup();
        const first = await ingest(actor, "sms", SMS, T0);
        expect(first.body.status).toBe("created");
        const [row] = await live(actor.id);
        expect(row).toMatchObject({ amount: 300, currency: "USD", originalAmount: 25000, originalCurrency: "INR" });

        // A correction rewrites the capture's eventKey; it must stay in rupees (the message's own unit).
        const { correctTransaction } = await import("@/lib/reconcile/correct");
        await correctTransaction({
          userId: actor.id, transactionId: String(row._id), changes: { category: "Food" }, reason: "wrong_category", via: "mobile", actor,
        } as never);
        const { default: CapturedMessage } = await import("@/models/CapturedMessage");
        const key = (await CapturedMessage.findOne({ user: actor.id }).lean<{ eventKey: { amount: number } }>())!.eventKey;
        expect(key.amount).toBe(25000);

        // Another channel, same payment, no bank reference: matched on amount, account and day.
        const copy = await ingest(actor, "n8n", `VM-HDFCBK: ${SMS}`, new Date(T0.getTime() + 5 * 60_000));
        expect(copy.body.status).toBe("duplicate");
        expect(await live(actor.id)).toHaveLength(1);
      });

      it("a later SMS over a notification's row keeps rupees in the eventKey too", async () => {
        const { actor } = await setup();
        await ingest(actor, "notification", NOTIF, T0);
        const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
        await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
        const sms = await ingest(actor, "sms", SMS, new Date(T0.getTime() + 120 * 60_000));
        expect(sms.body.status).toBe("updated");
        const [row] = await live(actor.id);
        expect(row).toMatchObject({ amount: 300, originalAmount: 25000, source: "sms" });
        const { default: CapturedMessage } = await import("@/models/CapturedMessage");
        const smsCapture = await CapturedMessage.findOne({ user: actor.id, channel: "sms" }).lean<{ eventKey: { amount: number } }>();
        expect(smsCapture!.eventKey.amount).toBe(25000);
      });

      it("a confirmed row the SMS disagrees with is still a source conflict, and nothing is overwritten", async () => {
        const { actor } = await setup();
        const REF = ". UPI Ref 426912345678";
        await ingest(actor, "notification", NOTIF + REF, T0);
        const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
        await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
        const { default: Transaction } = await import("@/models/Transaction");
        await Transaction.updateMany({ user: actor.id }, { $set: { reviewStatus: "confirmed" } });

        const sms = await ingest(actor, "sms", SMS.replace("Rs.250.00", "Rs.260.00").replace("Not you?", `UPI Ref 426912345678. Not you?`), new Date(T0.getTime() + 120 * 60_000));
        expect(sms.body).toMatchObject({ status: "queued", reason: "source_conflict" });
        const [row] = await live(actor.id);
        expect(row).toMatchObject({ amount: 300, originalAmount: 25000 });
      });

      it("the same amount on a confirmed row is no conflict", async () => {
        const { actor } = await setup();
        await ingest(actor, "notification", NOTIF, T0);
        const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
        await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
        const { default: Transaction } = await import("@/models/Transaction");
        await Transaction.updateMany({ user: actor.id }, { $set: { reviewStatus: "confirmed" } });
        const sms = await ingest(actor, "sms", SMS, new Date(T0.getTime() + 120 * 60_000));
        expect(sms.body.status).not.toBe("queued");
        expect(await live(actor.id)).toHaveLength(1);
      });
    });

    it("paying a card statement locks the base and books the payment in it", async () => {
      const { default: Account } = await import("@/models/Account");
      const { default: CreditStatement } = await import("@/models/CreditStatement");
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: userId }, { $set: { "preferences.currency": "USD" } });
      const card = await Account.create({
        user: userId, name: "Card", type: "credit_card", balance: 0, currency: "EUR",
        creditMeta: { billingCycleDay: 5, paymentDueDay: 20 },
      });
      const statement = await CreditStatement.collection.insertOne({
        user: new mongoose.Types.ObjectId(userId), account: card._id,
        periodStart: new Date("2026-08-05"), periodEnd: new Date("2026-09-04"), dueDate: new Date("2026-09-20"), isDeleted: false,
      });
      expect(await lockedOf(userId)).toBe(false);
      sessionUser.current = { id: userId, name: "FX", email: "fx@x.com", role: "user" };
      const { PATCH } = await import("@/app/api/credit-cards/[accountId]/statements/[statementId]/route");
      const res = await PATCH(
        new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ paidAmount: 5000, sourceAccountId: accountId }) }),
        { params: Promise.resolve({ accountId: String(card._id), statementId: String(statement.insertedId) }) }
      );
      sessionUser.current = null;
      expect(res.status).toBe(200);
      expect(await lockedOf(userId)).toBe(true);
      expect(await Transaction.findOne({ user: userId, type: "transfer" }).lean()).toMatchObject({ currency: "USD", amount: 5000 });
    });
  });

  describe("bank messages on an INR base after a matching row exists", () => {
    const REF = ". UPI Ref 426912345678";
    const NOTIF = `₹250 paid to Swiggy from A/c XX1234${REF}`;
    const SMS = (amount: string) => `Rs.${amount} debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici${REF}. Not you? Call 18002586161`;
    const T0 = new Date("2026-09-26T06:30:00Z");

    async function setup() {
      const { default: Account } = await import("@/models/Account");
      const user = await makeUser();
      const bank = await Account.create({ user: user._id, name: "HDFC", type: "bank", balance: 0, currency: "INR", smsLastFour: ["1234"] });
      return { user, bank, actor: { id: user._id.toString(), name: user.name, email: user.email, role: "user" } };
    }
    async function ingest(actor: { id: string; name: string; email: string; role: string }, channel: "sms" | "notification", text: string, at: Date) {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      return ingestCapture({ user: actor, channel, text, receivedAt: at, sender: channel === "sms" ? "VM-HDFCBK" : undefined });
    }
    async function promoted(actor: { id: string; name: string; email: string; role: string }) {
      await ingest(actor, "notification", NOTIF, T0);
      const { promoteStalePendingSms } = await import("@/lib/capture/ingest");
      await promoteStalePendingSms({ now: new Date(Date.now() + 16 * 60_000) });
      const { default: Transaction } = await import("@/models/Transaction");
      return Transaction;
    }
    const later = new Date(T0.getTime() + 120 * 60_000);

    it("a plain row is compared and overwritten as it always was", async () => {
      const { actor, bank } = await setup();
      const Transaction = await promoted(actor);
      const { default: Account } = await import("@/models/Account");
      const sms = await ingest(actor, "sms", SMS("260.00"), later);
      expect(sms.body.status).toBe("updated");
      expect(await Transaction.findOne({ user: actor.id }).lean()).toMatchObject({ amount: 26000, source: "sms" });
      expect((await Account.findById(bank._id))!.balance).toBe(-26000);
    });

    it("a confirmed plain row the SMS disagrees with is a source conflict", async () => {
      const { actor } = await setup();
      const Transaction = await promoted(actor);
      await Transaction.updateMany({ user: actor.id }, { $set: { reviewStatus: "confirmed" } });
      const sms = await ingest(actor, "sms", SMS("260.00"), later);
      expect(sms.body).toMatchObject({ status: "queued", reason: "source_conflict" });
      expect(await Transaction.findOne({ user: actor.id }).lean()).toMatchObject({ amount: 25000 });
    });

    it("a row with a USD original is not compared and keeps its converted amount", async () => {
      const { actor } = await setup();
      const Transaction = await promoted(actor);
      // 25000 paise is our conversion of a 3.00 USD spend, not the bank's figure.
      await Transaction.updateMany({ user: actor.id }, { $set: { originalAmount: 300, originalCurrency: "USD", originalExponent: 2, rate: 83.33333333, rateSource: "provider" } });

      // Unconfirmed: the SMS takes over the source, but never rewrites the amount.
      const sms = await ingest(actor, "sms", SMS("260.00"), later);
      expect(sms.body.status).toBe("updated");
      expect(await Transaction.findOne({ user: actor.id }).lean()).toMatchObject({ amount: 25000, originalAmount: 300, originalCurrency: "USD", source: "sms" });
    });

    it("a confirmed row with a USD original raises no conflict", async () => {
      const { actor } = await setup();
      const Transaction = await promoted(actor);
      await Transaction.updateMany({ user: actor.id }, { $set: { reviewStatus: "confirmed", originalAmount: 300, originalCurrency: "USD", originalExponent: 2, rate: 83.33333333, rateSource: "provider" } });
      const sms = await ingest(actor, "sms", SMS("260.00"), later);
      expect(sms.body.status).not.toBe("queued");
      expect(await Transaction.findOne({ user: actor.id }).lean()).toMatchObject({ amount: 25000 });
    });
  });

  describe("only a two-decimal currency can be the base for now", () => {
    const MESSAGE = /Only currencies with two decimals can be the base currency for now/;
    const setStoredBase = async (code: string) => {
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: userId }, { $set: { "preferences.currency": code } });
    };

    it("setBaseCurrency refuses JPY, KRW, VND, CLP, KWD, BHD, OMR and JOD with a clear error, and accepts two-decimal currencies", async () => {
      const { setBaseCurrency, BaseCurrencyError } = await import("@/lib/base-currency");
      for (const code of ["JPY", "KRW", "VND", "CLP", "KWD", "BHD", "OMR", "JOD"]) {
        const err = await setBaseCurrency(userId, code).catch((e) => e);
        expect(err).toBeInstanceOf(BaseCurrencyError);
        expect(err.code).toBe("UNSUPPORTED_BASE_CURRENCY");
        expect(err.message).toMatch(MESSAGE);
      }
      expect(await baseOfUser()).toBe("INR");
      expect(await setBaseCurrency(userId, "USD")).toBe("USD");
    });

    it("PATCH /currencies answers 400 with the error code", async () => {
      const { PATCH } = await import("@/app/api/integrations/currencies/route");
      const res = await PATCH(req("currencies", "PATCH", { base: "JPY" }), {});
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error.message).toMatch(MESSAGE);
      expect(error.details.errorCode).toBe("UNSUPPORTED_BASE_CURRENCY");
      expect(await baseOfUser()).toBe("INR");
    });

    it("PATCH /api/me/preferences refuses it too, and still saves the rest", async () => {
      const { PATCH } = await import("@/app/api/me/preferences/route");
      const call = (body: unknown) =>
        PATCH(new NextRequest("http://localhost/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }));
      sessionUser.current = { id: userId, name: "FX", email: "fx@x.com", role: "user" };
      const res = await call({ currency: "KWD" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "UNSUPPORTED_BASE_CURRENCY", error: expect.stringMatching(MESSAGE) });
      expect((await call({ currency: "INR", theme: "dark" })).status).toBe(200);
      sessionUser.current = null;
    });

    it("GET /currencies marks supportedAsBase per entry", async () => {
      const { GET } = await import("@/app/api/integrations/currencies/route");
      const { data } = await (await GET(req("currencies", "GET"), {})).json();
      const by = Object.fromEntries((data.currencies as { code: string; supportedAsBase: boolean }[]).map((c) => [c.code, c.supportedAsBase]));
      expect(by.INR).toBe(true);
      expect(by.USD).toBe(true);
      for (const code of ["JPY", "KRW", "VND", "CLP", "KWD", "BHD", "OMR", "JOD"]) expect(by[code]).toBe(false);
      expect(data.currencies.every((c: { supportedAsBase: unknown }) => typeof c.supportedAsBase === "boolean")).toBe(true);
    });

    it("a user whose stored base has the wrong exponent cannot add transactions: plain, same-currency original or foreign original", async () => {
      await setStoredBase("JPY");
      const { default: Transaction } = await import("@/models/Transaction");
      for (const body of [
        { amount: 1000 },
        { originalAmount: 1000, originalCurrency: "JPY" },
        { originalAmount: 1000, originalCurrency: "USD" },
      ]) {
        const res = await post(body);
        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error.message).toMatch(MESSAGE);
        expect(error.details.errorCode).toBe("UNSUPPORTED_BASE_CURRENCY");
      }
      expect(await Transaction.countDocuments({ user: userId })).toBe(0);
      // The refusal comes before the lock: nothing was written, the base is not pinned.
      const { default: User } = await import("@/models/User");
      expect((await User.findById(userId).lean<{ baseLocked?: boolean }>())!.baseLocked).toBeUndefined();
      expect(providerCalls.count).toBe(0);
    });

    it("a transfer for such a user is a 400, not a 500", async () => {
      await setStoredBase("KWD");
      const { default: Account } = await import("@/models/Account");
      const other = await Account.create({ user: userId, name: "Savings", type: "savings", balance: 0, currency: "INR" });
      const { POST } = await import("@/app/api/integrations/transfers/route");
      const res = await POST(req("transfers", "POST", { fromAccountId: accountId, toAccountId: String(other._id), amount: 1000 }), {});
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toMatch(MESSAGE);
    });

    it("saving the unchanged stored base does not fail, and other currencies stay fine as originals", async () => {
      await setStoredBase("JPY");
      const { setBaseCurrency } = await import("@/lib/base-currency");
      expect(await setBaseCurrency(userId, "JPY")).toBe("JPY");
      await setStoredBase("INR");
      const res = await post({ originalAmount: 1500, originalCurrency: "KWD" });
      expect(res.status).toBe(201);
      expect((await res.json()).data).toMatchObject({ originalCurrency: "KWD", originalExponent: 3, amount: 40541 });
      const jpy = await post({ originalAmount: 1000, originalCurrency: "JPY" });
      expect(jpy.status).toBe(201);
      expect((await jpy.json()).data).toMatchObject({ originalExponent: 0 });
    });
  });

  describe("bank messages (rupees) on a base currency that is not INR", () => {
    const SMS = "Rs.250.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678. Not you? Call 18002586161";
    const RECEIVED = new Date("2026-09-26T06:30:00Z");

    async function bankUser(base: string) {
      const { default: Account } = await import("@/models/Account");
      const user = await makeUser({ preferences: { currency: base } });
      const bank = await Account.create({ user: user._id, name: "HDFC", type: "bank", balance: 0, currency: "INR", smsLastFour: ["1234"] });
      const actor = { id: user._id.toString(), name: user.name, email: user.email, role: "user" };
      return { user, bank, actor };
    }
    async function ingest(actor: { id: string; name: string; email: string; role: string }) {
      const { ingestCapture } = await import("@/lib/capture/ingest");
      return ingestCapture({ user: actor, channel: "sms", text: SMS, receivedAt: RECEIVED, sender: "VM-HDFCBK" });
    }

    it("INR base: booked exactly as before, no original fields, no rate call", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      const { actor } = await bankUser("INR");
      const res = await ingest(actor);
      expect(res.body.status).toBe("created");
      const txn = await Transaction.findOne({ user: actor.id }).lean<Record<string, unknown>>();
      expect(txn).toMatchObject({ amount: 25000, currency: "INR" });
      expect(txn!.originalCurrency).toBeUndefined();
      expect(txn!.rate).toBeUndefined();
      expect(providerCalls.count).toBe(0);
    });

    it("USD base: the rupee amount is converted with the rate service and the original kept", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Account } = await import("@/models/Account");
      const { actor, bank } = await bankUser("USD");
      const res = await ingest(actor);
      expect(res.body.status).toBe("created");
      const txn = await Transaction.findOne({ user: actor.id }).lean<Record<string, unknown>>();
      // 250.00 INR at 0.012 USD per rupee = 3.00 USD
      expect(txn).toMatchObject({ amount: 300, currency: "USD", originalAmount: 25000, originalCurrency: "INR", rateSource: "provider" });
      expect((await Account.findById(bank._id))!.balance).toBe(-300);
    });

    it("USD base with no rate: nothing is booked, the message waits in review, and it can be confirmed later", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Account } = await import("@/models/Account");
      const { default: CapturedMessage } = await import("@/models/CapturedMessage");
      const { actor, bank } = await bankUser("USD");
      providerCalls.mode = "down";
      const res = await ingest(actor);
      expect(res.body).toMatchObject({ status: "queued", reason: "rate_unavailable" });
      expect(await Transaction.countDocuments({ user: actor.id })).toBe(0);
      expect((await Account.findById(bank._id))!.balance).toBe(0);
      const capture = await CapturedMessage.findOne({ user: actor.id }).lean<{ _id: unknown; outcome: string; status: string }>();
      expect(capture).toMatchObject({ outcome: "queued", status: "pending" });

      // The provider is back: resolving the queued message converts the rupees.
      providerCalls.mode = "ok";
      await forgetFailedAttempt();
      const { resolveCapture } = await import("@/lib/reconcile/inbox");
      await resolveCapture({
        userId: actor.id,
        captureId: String(capture!._id),
        input: { action: "create", accountId: bank._id.toString(), type: "expense", amount: 25000, category: "Food" } as never,
        actor,
        via: "web",
      });
      const txn = await Transaction.findOne({ user: actor.id }).lean<Record<string, unknown>>();
      expect(txn).toMatchObject({ amount: 300, currency: "USD", originalCurrency: "INR", originalAmount: 25000 });
    });
  });
});
