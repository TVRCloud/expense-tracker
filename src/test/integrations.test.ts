import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
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
