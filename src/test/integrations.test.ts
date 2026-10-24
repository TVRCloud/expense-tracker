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
    const off = await (await PUT(req("PUT", { dailyAmount: 100000 }), undefined as never)).json();
    expect(off.data.today.limit).toBe(100000);
    const on = await (await PUT(req("PUT", { rollover: true }), undefined as never)).json();
    expect(on.data.today.limit).toBe(175000);
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
