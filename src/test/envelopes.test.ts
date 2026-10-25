import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", () => ({ redis: null }));

// Session auth for the browser routes: each test sets `sessionUser.current`.
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

process.env.CAPTURE_ENCRYPTION_KEY = "test-capture-encryption-key-at-least-32-chars";

let mongod: MongoMemoryReplSet;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongod.getUri();
  const { default: connectDB } = await import("@/lib/mongodb");
  await connectDB();
});

afterEach(async () => {
  vi.useRealTimers();
  const { resetAuthCacheForTests } = await import("@/lib/integrations/auth");
  const { resetRateLimitWindowsForTests } = await import("@/lib/integrations/rate-limit");
  resetAuthCacheForTests();
  resetRateLimitWindowsForTests();
  sessionUser.current = null;
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const KEY_A = "test-envelope-api-key-user-a";
const KEY_B = "test-envelope-api-key-user-b";
const MONTH = "2026-10";
const PREV = "2026-09";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("envelope mode", () => {
  let a: string;
  let b: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const ua = await User.create({ name: "A", email: `a${Date.now()}${Math.random()}@x.com`, password: "hash-a", isActive: true });
    const ub = await User.create({ name: "B", email: `b${Date.now()}${Math.random()}@x.com`, password: "hash-b", isActive: true });
    await ApiKey.create({ user: ua._id, label: "phone", keyHash: hashKey(KEY_A), lastFour: KEY_A.slice(-4) });
    await ApiKey.create({ user: ub._id, label: "phone", keyHash: hashKey(KEY_B), lastFour: KEY_B.slice(-4) });
    a = ua._id.toString();
    b = ub._id.toString();
  });

  function req(path: string, method: string, body?: unknown, key = KEY_A, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  }
  const idem = (given?: string) => ({ "idempotency-key": given ?? `k-${(n += 1)}` });

  async function enable(key = KEY_A) {
    const { PUT } = await import("@/app/api/integrations/envelopes/settings/route");
    return PUT(req("envelopes/settings", "PUT", { enabled: true }, key, idem()), {});
  }
  async function get(month: string | null = MONTH, key = KEY_A) {
    const { GET } = await import("@/app/api/integrations/envelopes/route");
    const res = await GET(req(`envelopes${month ? `?month=${month}` : ""}`, "GET", undefined, key), {});
    return { res, json: (await res.json()) as Json };
  }
  async function put(body: unknown, key = KEY_A, headers: Record<string, string> = idem()) {
    const { PUT } = await import("@/app/api/integrations/envelopes/route");
    const res = await PUT(req("envelopes", "PUT", body, key, headers), {});
    return { res, json: (await res.json()) as Json };
  }
  async function move(body: unknown, key = KEY_A, headers: Record<string, string> = idem()) {
    const { POST } = await import("@/app/api/integrations/envelopes/move/route");
    const res = await POST(req("envelopes/move", "POST", body, key, headers), {});
    return { res, json: (await res.json()) as Json };
  }
  async function copy(body: unknown, key = KEY_A) {
    const { POST } = await import("@/app/api/integrations/envelopes/copy/route");
    const res = await POST(req("envelopes/copy", "POST", body, key, idem()), {});
    return { res, json: (await res.json()) as Json };
  }
  async function account(user = a) {
    const { default: Account } = await import("@/models/Account");
    return Account.create({ user, name: "Bank", type: "bank", balance: 100000 });
  }
  async function spend(user: string, acc: unknown, category: string, amount: number, over: Record<string, unknown> = {}) {
    const { default: Transaction } = await import("@/models/Transaction");
    return Transaction.create({
      user,
      account: acc,
      type: "expense",
      amount,
      category,
      date: new Date(2026, 9, 12, 12),
      ...over,
    });
  }
  const row = (json: Json, category: string) => (json.data.envelopes as Json[]).find((e) => e.category === category) as Json;
  const plan = (income: number, assign: [string, number][], month = MONTH) => ({
    month,
    income,
    assign: assign.map(([category, assigned]) => ({ category, assigned })),
  });

  describe("turning it on", () => {
    it("is off by default: an empty plan, and writes are refused with a clear code", async () => {
      const { res, json } = await get();
      expect(res.status).toBe(200);
      expect(json.data).toMatchObject({ enabled: false, month: MONTH, income: 0, assigned: 0, unassigned: 0, envelopes: [], moves: [] });

      const written = await put(plan(100000, [["Food", 40000]]));
      expect(written.res.status).toBe(409);
      expect(written.json.error.details.errorCode).toBe("ENVELOPES_DISABLED");
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      expect(await EnvelopePlan.countDocuments({})).toBe(0);
    });

    it("settings turn it on and off, keeping plans in between", async () => {
      expect((await enable()).status).toBe(200);
      expect((await put(plan(100000, [["Food", 40000]]))).res.status).toBe(200);
      const { GET, PUT } = await import("@/app/api/integrations/envelopes/settings/route");
      expect(((await (await GET(req("envelopes/settings", "GET"), {})).json()) as Json).data).toEqual({ enabled: true });
      await PUT(req("envelopes/settings", "PUT", { enabled: false }, KEY_A, idem()), {});
      expect((await get()).json.data.enabled).toBe(false);
      expect((await get()).json.data.envelopes).toEqual([]);
      await enable();
      expect(row((await get()).json, "Food")).toMatchObject({ assigned: 40000 });
    });

    it("rejects a settings body that is not { enabled: boolean }", async () => {
      const { PUT } = await import("@/app/api/integrations/envelopes/settings/route");
      expect((await PUT(req("envelopes/settings", "PUT", { enabled: "yes" }, KEY_A, idem()), {})).status).toBe(400);
      expect((await PUT(req("envelopes/settings", "PUT", { enabled: true, extra: 1 }, KEY_A, idem()), {})).status).toBe(400);
    });
  });

  describe("assigning money", () => {
    beforeEach(async () => {
      await enable();
    });

    it("keeps unassigned = income - assigned, and flags over-assigning without blocking it", async () => {
      const first = await put(plan(100000, [["Food", 40000], ["Rent", 50000]]));
      expect(first.res.status).toBe(200);
      expect(first.json.data).toMatchObject({ income: 100000, assigned: 90000, unassigned: 10000, overAssigned: false });

      const over = await put({ month: MONTH, assign: [{ category: "Fun", assigned: 20000 }] });
      expect(over.json.data).toMatchObject({ assigned: 110000, unassigned: -10000, overAssigned: true });
      expect((over.json.data.envelopes as Json[]).map((e) => e.category)).toEqual(["Food", "Rent", "Fun"]);
    });

    it("changes an amount in place, keeps the order, and removes an envelope", async () => {
      await put(plan(100000, [["Food", 40000], ["Rent", 50000], ["Fun", 5000]]));
      const changed = await put({ month: MONTH, assign: [{ category: "Rent", assigned: 45000 }], remove: ["Food"] });
      expect((changed.json.data.envelopes as Json[]).map((e) => [e.category, e.assigned])).toEqual([["Rent", 45000], ["Fun", 5000]]);
      expect(changed.json.data.income).toBe(100000); // untouched
    });

    it("can set income alone", async () => {
      const r = await put({ month: MONTH, income: 250000 });
      expect(r.json.data).toMatchObject({ income: 250000, assigned: 0, unassigned: 250000 });
    });

    it("reads spent and left from the budget numbers: splits count per category, deleted rows and refunds are handled", async () => {
      const acc = await account();
      await put(plan(100000, [["Food", 30000], ["Fun", 10000]]));
      await spend(a, acc._id, "Food", 12000);
      const group = new mongoose.Types.ObjectId();
      await spend(a, acc._id, "Food", 3000, { splitGroupId: group });
      await spend(a, acc._id, "Fun", 4000, { splitGroupId: group });
      await spend(a, acc._id, "Food", 9999, { isDeleted: true }); // not counted
      const refunded = await spend(a, acc._id, "Fun", 1500);
      const { default: Transaction } = await import("@/models/Transaction");
      await Transaction.create({
        user: a, account: acc._id, type: "income", amount: 1500, category: "Fun", date: new Date(2026, 9, 13, 12),
        refundOf: refunded._id, refundStatus: "confirmed",
      });
      await spend(a, acc._id, "Food", 50000, { date: new Date(2026, 8, 20, 12) }); // last month: not counted

      const { json } = await get();
      expect(row(json, "Food")).toMatchObject({ assigned: 30000, spent: 15000, left: 15000, overspent: false });
      expect(row(json, "Fun")).toMatchObject({ assigned: 10000, spent: 4000, left: 6000 });
    });

    it("shows an overspent envelope with a negative left", async () => {
      const acc = await account();
      await put(plan(50000, [["Food", 5000]]));
      await spend(a, acc._id, "Food", 8000);
      expect(row((await get()).json, "Food")).toMatchObject({ left: -3000, overspent: true });
    });

    it("suggests budget categories that are not envelopes yet", async () => {
      const { default: Budget } = await import("@/models/Budget");
      await Budget.create({ user: a, category: "Food", month: 10, year: 2026, limitAmount: 30000 });
      await Budget.create({ user: a, category: "Fun", month: 10, year: 2026, limitAmount: 9000 });
      await Budget.create({ user: a, category: "Old", month: 10, year: 2026, limitAmount: 1, isDeleted: true });
      await put(plan(100000, [["Food", 30000]]));
      expect((await get()).json.data.suggested).toEqual([{ category: "Fun", limitAmount: 9000 }]);
    });

    it("caps a month at 60 envelopes, whole requests or one more", async () => {
      const sixty: [string, number][] = Array.from({ length: 60 }, (_, i) => [`E${i}`, 1]);
      expect((await put(plan(0, sixty))).res.status).toBe(200);
      const one = await put({ month: MONTH, assign: [{ category: "One more", assigned: 1 }] });
      expect(one.res.status).toBe(400);
      expect(one.json.error.details.errorCode).toBe("TOO_MANY");
      expect((await get()).json.data.envelopes).toHaveLength(60);
      // taking one out in the same request makes room
      const swap = await put({ month: MONTH, assign: [{ category: "One more", assigned: 1 }], remove: ["E0"] });
      expect(swap.res.status).toBe(200);
      expect(swap.json.data.envelopes).toHaveLength(60);
      const tooBig = await put(plan(0, Array.from({ length: 61 }, (_, i) => [`X${i}`, 1])));
      expect(tooBig.res.status).toBe(400);
    });

    it("a write refused for too many envelopes does not lock the base currency", async () => {
      const { default: User } = await import("@/models/User");
      await put(plan(0, Array.from({ length: 60 }, (_, i) => [`E${i}`, 0])));
      const r = await put({ month: MONTH, income: 5, assign: [{ category: "One more", assigned: 5 }] });
      expect(r.res.status).toBe(400);
      expect((await User.findById(a).lean<{ baseLocked?: boolean }>())!.baseLocked).toBeFalsy();
    });

    it("validates the body", async () => {
      for (const body of [
        { month: "2026-13", income: 1 },
        { month: "26-10", income: 1 },
        { month: MONTH },
        { month: MONTH, income: -1 },
        { month: MONTH, income: 1.5 },
        { month: MONTH, income: 1e13 + 1 },
        { month: MONTH, assign: [{ category: "", assigned: 1 }] },
        { month: MONTH, assign: [{ category: "Food", assigned: -5 }] },
        { month: MONTH, assign: [{ category: "Food", assigned: 1 }, { category: "Food", assigned: 2 }] },
        { month: MONTH, assign: [{ category: "Food", assigned: 1 }], remove: ["Food"] },
        { month: MONTH, income: 1, stray: true },
        "not json {",
      ]) {
        const r = await put(body);
        expect(r.res.status, JSON.stringify(body)).toBe(400);
      }
      const noKey = await put(plan(1, []), KEY_A, {});
      expect(noKey.res.status).toBe(400);
    });

    it("is idempotent: the same key and body applies once, a different body with the key is a conflict", async () => {
      const headers = idem("same-key");
      const first = await put(plan(100000, [["Food", 40000]]), KEY_A, headers);
      const again = await put(plan(100000, [["Food", 40000]]), KEY_A, headers);
      expect(again.res.status).toBe(first.res.status);
      expect(again.json.data).toEqual(first.json.data);
      const clash = await put(plan(100000, [["Food", 41000]]), KEY_A, headers);
      expect(clash.res.status).toBe(409);
      expect(clash.json.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  describe("moving money", () => {
    beforeEach(async () => {
      await enable();
      await put(plan(100000, [["Food", 40000], ["Rent", 50000], ["Fun", 5000]]));
    });

    it("moves between envelopes and records the move, newest first", async () => {
      const first = await move({ month: MONTH, from: "Food", to: "Fun", amount: 10000 });
      expect(first.res.status).toBe(200);
      expect(row(first.json, "Food").assigned).toBe(30000);
      expect(row(first.json, "Fun").assigned).toBe(15000);
      expect(first.json.data.assigned).toBe(95000); // moving never changes the total
      const second = await move({ month: MONTH, from: "Rent", to: "Fun", amount: 2500 });
      expect(second.json.data.moves.map((m: Json) => [m.from, m.to, m.amount])).toEqual([["Rent", "Fun", 2500], ["Food", "Fun", 10000]]);
    });

    it("refuses to take more than is assigned, and changes nothing", async () => {
      const r = await move({ month: MONTH, from: "Fun", to: "Food", amount: 5001 });
      expect(r.res.status).toBe(400);
      expect(r.json.error.details.errorCode).toBe("INSUFFICIENT");
      const { json } = await get();
      expect(row(json, "Fun").assigned).toBe(5000);
      expect(row(json, "Food").assigned).toBe(40000);
      expect(json.data.moves).toEqual([]);
    });

    it("refuses to take money that is already spent unless overspending is allowed", async () => {
      const acc = await account();
      await spend(a, acc._id, "Food", 35000);
      const refused = await move({ month: MONTH, from: "Food", to: "Fun", amount: 10000 });
      expect(refused.res.status).toBe(400);
      expect(refused.json.error.details.errorCode).toBe("INSUFFICIENT");
      expect(refused.json.error.message).toMatch(/already spent/);
      const ok = await move({ month: MONTH, from: "Food", to: "Fun", amount: 5000 }); // leaves exactly what was spent
      expect(ok.res.status).toBe(200);
      expect(row(ok.json, "Food")).toMatchObject({ assigned: 35000, spent: 35000, left: 0 });
      const more = await move({ month: MONTH, from: "Food", to: "Fun", amount: 1 }); // now nothing is free
      expect(more.res.status).toBe(400);
    });

    it("allowOverdraw lets the source drop below what it spent, never below zero", async () => {
      const acc = await account();
      await spend(a, acc._id, "Food", 35000);
      const ok = await move({ month: MONTH, from: "Food", to: "Fun", amount: 30000, allowOverdraw: true });
      expect(ok.res.status).toBe(200);
      expect(row(ok.json, "Food")).toMatchObject({ assigned: 10000, spent: 35000, overspent: true, left: -25000 });
      const tooMuch = await move({ month: MONTH, from: "Food", to: "Fun", amount: 10001, allowOverdraw: true });
      expect(tooMuch.res.status).toBe(400);
    });

    it("answers 404 for an envelope that is not in the plan, and 400 for the same envelope twice", async () => {
      const missing = await move({ month: MONTH, from: "Food", to: "Nope", amount: 1 });
      expect(missing.res.status).toBe(404);
      expect(missing.json.error.details.errorCode).toBe("ENVELOPE_NOT_FOUND");
      expect((await move({ month: MONTH, from: "Food", to: "Food", amount: 1 })).res.status).toBe(400);
      expect((await move({ month: "2026-08", from: "Food", to: "Fun", amount: 1 })).res.status).toBe(404);
      expect((await move({ month: MONTH, from: "Food", to: "Fun", amount: 0 })).res.status).toBe(400);
      expect((await move({ month: MONTH, from: "Food", to: "Fun", amount: 1.5 })).res.status).toBe(400);
    });

    it("never lets the receiving envelope pass the maximum", async () => {
      await put({ month: MONTH, assign: [{ category: "Big", assigned: 1e13 }] });
      const r = await move({ month: MONTH, from: "Food", to: "Big", amount: 1 });
      expect(r.res.status).toBe(400);
      expect(r.json.error.details.errorCode).toBe("INSUFFICIENT");
      // the message names the receiver, not the source that had enough
      expect(r.json.error.message).toMatch(/Big would pass the largest amount/);
      expect(r.json.error.message).not.toMatch(/Food has/);
      expect(row((await get()).json, "Food").assigned).toBe(40000);
    });

    it("is atomic under concurrency: five moves of 300 out of 1000 let exactly three through", async () => {
      await put({ month: MONTH, assign: [{ category: "Pot", assigned: 1000 }, { category: "Sink", assigned: 0 }] });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => move({ month: MONTH, from: "Pot", to: "Sink", amount: 300, allowOverdraw: true }))
      );
      expect(results.filter((r) => r.res.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.res.status === 400)).toHaveLength(2);
      const { json } = await get();
      expect(row(json, "Pot").assigned).toBe(100);
      expect(row(json, "Sink").assigned).toBe(900);
      expect(json.data.moves).toHaveLength(3);
    });

    it("keeps only the last 50 moves", async () => {
      await put({ month: MONTH, assign: [{ category: "Pot", assigned: 1000 }, { category: "Sink", assigned: 0 }] });
      for (let i = 0; i < 55; i += 1) await move({ month: MONTH, from: "Pot", to: "Sink", amount: 1, allowOverdraw: true });
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      const stored = await EnvelopePlan.findOne({ user: a, month: MONTH }).lean<{ moves: unknown[] }>();
      expect(stored!.moves).toHaveLength(50);
      expect((await get()).json.data.moves).toHaveLength(20);
    });

    it("a retried move with the same key moves once", async () => {
      const headers = idem("move-once");
      await move({ month: MONTH, from: "Food", to: "Fun", amount: 1000 }, KEY_A, headers);
      await move({ month: MONTH, from: "Food", to: "Fun", amount: 1000 }, KEY_A, headers);
      expect(row((await get()).json, "Fun").assigned).toBe(6000);
    });
  });

  describe("copying a month", () => {
    beforeEach(async () => {
      await enable();
    });

    it("copies the month before into an empty month, income and envelopes", async () => {
      await put(plan(120000, [["Food", 40000], ["Rent", 60000]], PREV));
      expect((await get()).json.data).toMatchObject({ hasPrevious: true, previousMonth: PREV });
      const r = await copy({ month: MONTH });
      expect(r.res.status).toBe(200);
      expect(r.json.data).toMatchObject({ income: 120000, assigned: 100000, unassigned: 20000 });
      expect((r.json.data.envelopes as Json[]).map((e) => [e.category, e.assigned])).toEqual([["Food", 40000], ["Rent", 60000]]);
      // moves are not copied
      expect(r.json.data.moves).toEqual([]);
    });

    it("copies from a chosen month, and the source stays as it was", async () => {
      await put(plan(90000, [["Food", 90000]], "2026-07"));
      expect((await copy({ month: MONTH, from: "2026-07" })).res.status).toBe(200);
      expect(row((await get("2026-07")).json, "Food").assigned).toBe(90000);
    });

    it("refuses a month that already has envelopes, and a month with nothing to copy", async () => {
      await put(plan(1, [["Food", 1]], PREV));
      await put(plan(1, [["Rent", 1]]));
      const full = await copy({ month: MONTH });
      expect(full.res.status).toBe(409);
      expect(full.json.error.details.errorCode).toBe("PLAN_NOT_EMPTY");
      expect(row((await get()).json, "Rent")).toBeTruthy();

      const none = await copy({ month: "2026-05" });
      expect(none.res.status).toBe(404);
      expect(none.json.error.details.errorCode).toBe("NOTHING_TO_COPY");
      expect((await copy({ month: MONTH, from: MONTH })).res.status).toBe(400);
    });

    it("a rejected copy does not lock the base currency", async () => {
      const { default: User } = await import("@/models/User");
      await put(plan(0, [["Food", 0]], PREV)); // no money yet, so nothing locked
      await put(plan(0, [["Rent", 0]]));
      expect((await copy({ month: MONTH })).res.status).toBe(409);
      expect((await User.findById(a).lean<{ baseLocked?: boolean }>())!.baseLocked).toBeFalsy();
      // and a copy that works does lock it
      expect((await copy({ month: "2026-11", from: MONTH })).res.status).toBe(200);
      expect((await User.findById(a).lean<{ baseLocked?: boolean }>())!.baseLocked).toBe(true);
    });

    it("handles January: the month before is December of the year before", async () => {
      await put(plan(5000, [["Food", 5000]], "2025-12"));
      expect((await copy({ month: "2026-01" })).res.status).toBe(200);
    });
  });

  describe("base currency", () => {
    it("locks the base on the first amount, and then the base cannot change", async () => {
      await enable();
      const { default: User } = await import("@/models/User");
      await put({ month: MONTH, assign: [{ category: "Food", assigned: 0 }] });
      expect((await User.findById(a).lean<{ baseLocked?: boolean }>())!.baseLocked).toBeFalsy(); // zero amounts write no money
      await put({ month: MONTH, income: 1 });
      expect((await User.findById(a).lean<{ baseLocked?: boolean }>())!.baseLocked).toBe(true);
      const { setBaseCurrency } = await import("@/lib/base-currency");
      await expect(setBaseCurrency(a, "USD")).rejects.toMatchObject({ code: "HAS_MONEY_DATA" });
    });

    it("an envelope plan with money is money data even when the lock flag is missing", async () => {
      await enable();
      await put({ month: MONTH, income: 500 });
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: a }, { $unset: { baseLocked: 1 } });
      const { hasMoneyData } = await import("@/lib/base-currency");
      expect(await hasMoneyData(a)).toBe(true);
    });

    it("refuses writes for a base that is not two-decimal", async () => {
      await enable();
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: a }, { $set: { "preferences.currency": "JPY" } });
      const r = await put(plan(1000, [["Food", 100]]));
      expect(r.res.status).toBe(400);
      expect(r.json.error.code).toBe("BASE_CURRENCY_ONLY_TWO_DECIMALS");
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      expect(await EnvelopePlan.countDocuments({})).toBe(0);
      expect(((await User.findById(a).lean()) as { baseLocked?: boolean }).baseLocked).toBeFalsy();
    });

    it("reports the base currency and its decimals", async () => {
      expect((await get()).json.data).toMatchObject({ currency: "INR", exponent: 2 });
    });
  });

  describe("time zones", () => {
    it("this month is the month on the user's wall clock", async () => {
      await enable();
      const { default: User } = await import("@/models/User");
      vi.useFakeTimers({ toFake: ["Date"] });
      // 31 Oct 12:00 UTC is already 1 Nov in Auckland, still 31 Oct in Los Angeles
      vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
      await User.updateOne({ _id: a }, { $set: { "preferences.timezone": "Pacific/Auckland" } });
      expect((await get(null)).json.data.month).toBe("2026-11");
      await User.updateOne({ _id: a }, { $set: { "preferences.timezone": "America/Los_Angeles" } });
      expect((await get(null)).json.data.month).toBe("2026-10");
      // a bad zone falls back to the default instead of failing
      await User.updateOne({ _id: a }, { $set: { "preferences.timezone": "Nowhere/Land" } });
      expect((await get(null)).res.status).toBe(200);
    });
  });

  describe("isolation", () => {
    it("one user never sees or changes another user's plan", async () => {
      await enable();
      await enable(KEY_B);
      await put(plan(100000, [["Food", 40000], ["Fun", 5000]]));
      const other = await get(MONTH, KEY_B);
      expect(other.json.data.envelopes).toEqual([]);
      expect(other.json.data.income).toBe(0);
      const steal = await move({ month: MONTH, from: "Food", to: "Fun", amount: 1 }, KEY_B);
      expect(steal.res.status).toBe(404);
      // B's own plan with the same names is independent
      await put(plan(500, [["Food", 500]]), KEY_B);
      expect(row((await get()).json, "Food").assigned).toBe(40000);
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      expect(await EnvelopePlan.countDocuments({ user: a })).toBe(1);
      expect(await EnvelopePlan.countDocuments({ user: b })).toBe(1);
    });

    it("spent counts only the caller's spending", async () => {
      await enable();
      await put(plan(100000, [["Food", 40000]]));
      const accB = await account(b);
      await spend(b, accB._id, "Food", 9999);
      expect(row((await get()).json, "Food").spent).toBe(0);
    });

    it("needs a valid API key", async () => {
      const { GET } = await import("@/app/api/integrations/envelopes/route");
      expect((await GET(req("envelopes", "GET", undefined, "wrong-key"), {})).status).toBe(401);
    });
  });

  describe("realtime and the web routes", () => {
    it("a change shows up as `envelopes` in the polling fallback", async () => {
      await enable();
      const since = new Date(Date.now() - 1000);
      await put(plan(1000, [["Food", 1000]]));
      const { resourcesChangedSince } = await import("@/lib/realtime/changed-since");
      expect(await resourcesChangedSince(a, since)).toContain("envelopes");
    });

    it("a browser move sent twice with one Idempotency-Key moves money once, and a replayed refusal stays refused", async () => {
      sessionUser.current = { id: a, name: "A", email: "a@x.com", role: "user" };
      await enable();
      await put(plan(10000, [["Food", 1000], ["Fun", 0]]));
      const moves = await import("@/app/api/envelopes/move/route");
      const send = (key: string | null, amount: number) =>
        moves.POST(
          new NextRequest("http://localhost/api/envelopes/move", {
            method: "POST",
            headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
            body: JSON.stringify({ month: MONTH, from: "Food", to: "Fun", amount, allowOverdraw: true }),
          })
        );
      const both = await Promise.all([send("dbl-1", 400), send("dbl-1", 400)]);
      const statuses = both.map((r) => r.status);
      expect(statuses).toContain(200);
      expect(statuses.every((c) => c === 200 || c === 409)).toBe(true); // the other is replayed, or still in progress
      // however the two settled, exactly one move ran
      expect(row((await get()).json, "Fun").assigned).toBe(400);
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      expect((await EnvelopePlan.findOne({ user: a, month: MONTH }).lean<{ moves: unknown[] }>())!.moves).toHaveLength(1);
      await send("dbl-1", 400); // a later retry replays
      expect(row((await get()).json, "Fun").assigned).toBe(400);

      // same key, other body is refused; no key still works as before
      const clash = await send("dbl-1", 500);
      expect(clash.status).toBe(409);
      expect(((await clash.json()) as Json).code).toBe("IDEMPOTENCY_CONFLICT");
      expect((await send(null, 100)).status).toBe(200);
      expect(row((await get()).json, "Fun").assigned).toBe(500);

      // a refusal is stored with the key: replay gives the same 400, a new key runs again
      expect((await send("big-1", 5000)).status).toBe(400);
      await put({ month: MONTH, assign: [{ category: "Food", assigned: 9000 }] });
      expect((await send("big-1", 5000)).status).toBe(400);
      expect((await send("big-2", 5000)).status).toBe(200);
      expect((await send("bad key!", 1)).status).toBe(400);
    });

    it("the browser routes give the same plan to a signed-in user and map errors to statuses", async () => {
      const { default: User } = await import("@/models/User");
      sessionUser.current = { id: a, name: "A", email: "a@x.com", role: "user" };
      const settings = await import("@/app/api/envelopes/settings/route");
      const plans = await import("@/app/api/envelopes/route");
      const moves = await import("@/app/api/envelopes/move/route");
      const copies = await import("@/app/api/envelopes/copy/route");
      const call = (path: string, method: string, body?: unknown) =>
        new NextRequest(`http://localhost/api/envelopes${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

      expect((await plans.PUT(call("", "PUT", plan(1000, [["Food", 500]])))).status).toBe(409); // still off
      expect((await settings.PUT(call("/settings", "PUT", { enabled: true }))).status).toBe(200);
      const set = await plans.PUT(call("", "PUT", plan(1000, [["Food", 500], ["Fun", 100]])));
      expect(set.status).toBe(200);
      expect(((await set.json()) as Json).data).toMatchObject({ assigned: 600, unassigned: 400 });
      const moved = await moves.POST(call("/move", "POST", { month: MONTH, from: "Food", to: "Fun", amount: 100 }));
      expect(((await moved.json()) as Json).data.envelopes.map((e: Json) => e.assigned)).toEqual([400, 200]);
      expect((await moves.POST(call("/move", "POST", { month: MONTH, from: "Food", to: "Nope", amount: 1 }))).status).toBe(404);
      expect((await copies.POST(call("/copy", "POST", { month: MONTH }))).status).toBe(404); // nothing before it
      expect((await plans.PUT(call("", "PUT", { month: "bad" }))).status).toBe(400);
      const read = await plans.GET(new NextRequest(`http://localhost/api/envelopes?month=${MONTH}`));
      expect(((await read.json()) as Json).data.envelopes).toHaveLength(2);
      expect((await plans.GET(new NextRequest("http://localhost/api/envelopes?month=nope"))).status).toBe(400);

      sessionUser.current = null;
      expect((await plans.GET(new NextRequest(`http://localhost/api/envelopes?month=${MONTH}`))).status).toBe(401);
      expect((await moves.POST(call("/move", "POST", {}))).status).toBe(401);
      expect(await User.countDocuments({})).toBe(2);
    });
  });
});
