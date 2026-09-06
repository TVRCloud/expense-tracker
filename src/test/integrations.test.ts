import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

// Redis is optional in this app (returns null when REDIS_URL is unset) — the
// suite exercises that same "Redis unavailable" code path everywhere rather
// than standing up a real Redis instance.
vi.mock("@/lib/redis", () => ({ redis: null }));

// All test-related code (setup + every suite) lives in this single file by
// design, rather than a separate setup.ts + one file per module.

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
    process.env.N8N_API_KEY = TEST_KEY;
    process.env.N8N_USER_EMAIL = TEST_EMAIL;
    const { default: User } = await import("@/models/User");
    await User.create({ name: "N8N User", email: TEST_EMAIL, password: "hash", isActive: true });
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

  it("rejects a valid key when the configured user is missing", async () => {
    const { verifyN8nAuth } = await import("@/lib/integrations/auth");
    const { default: User } = await import("@/models/User");
    await User.deleteMany({});
    const result = await verifyN8nAuth(makeReq({ authorization: `Bearer ${TEST_KEY}` }), "req-5");
    expect("errorResponse" in result).toBe(true);
    if ("errorResponse" in result) expect(result.errorResponse.status).toBe(401);
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
    process.env.N8N_API_KEY = TEST_KEY;
    process.env.N8N_USER_EMAIL = TEST_EMAIL;
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: Account } = await import("@/models/Account");
    const user = await User.create({ name: "N8N Route User", email: TEST_EMAIL, password: "hash", isActive: true });
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
