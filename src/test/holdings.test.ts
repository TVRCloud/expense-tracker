import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", () => ({ redis: null }));

// Session auth for the browser routes (/api/holdings); set `sessionUser.current` to act as a signed-in user.
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

const KEY = "test-holdings-api-key";

describe("holdings", () => {
  let userId: string;
  let otherId: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const user = await User.create({ name: "H User", email: `h${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    const other = await User.create({ name: "Other", email: `ho${Date.now()}${Math.random()}@x.com`, password: "hash", isActive: true });
    await ApiKey.create({ user: user._id, label: "phone", keyHash: hashKey(KEY), lastFour: KEY.slice(-4) });
    userId = user._id.toString();
    otherId = other._id.toString();
  });

  function req(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "idempotency-key": `h-key-${n}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const stock = (over: Record<string, unknown> = {}) => ({ name: "Infosys", kind: "stock", units: "10", investedAmount: 1_000_000, ...over });
  const deposit = (over: Record<string, unknown> = {}) => ({
    name: "Bank FD",
    kind: "fixed_deposit",
    fd: { principal: 10_000_000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2027-01-01" },
    ...over,
  });

  async function create(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/integrations/holdings/route");
    return POST(req("holdings", "POST", body, headers), {});
  }
  async function setValue(id: string, body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/integrations/holdings/[id]/value/route");
    return POST(req(`holdings/${id}/value`, "POST", body), ctx(id));
  }
  const idOf = async (res: Response) => (await res.json()).data.id as string;

  describe("create", () => {
    it("adds a holding with its derived fields and replays on the same key", async () => {
      const { default: Holding } = await import("@/models/Holding");
      const first = await create(stock({ currentValue: 1_250_000 }), { "idempotency-key": "mk" });
      expect(first.status).toBe(201);
      const { data } = await first.json();
      expect(data).toMatchObject({
        name: "Infosys",
        kind: "stock",
        units: "10",
        invested: 1_000_000,
        value: 1_250_000,
        gain: 250_000,
        gainPercent: 25,
        sip: null,
        fd: null,
      });
      const replay = await create(stock({ currentValue: 1_250_000 }), { "idempotency-key": "mk" });
      expect((await replay.json()).data.id).toBe(data.id);
      expect(await Holding.countDocuments({ user: userId })).toBe(1);
      // a nested field differing is a different request (the fingerprint covers nested input)
      const clash = await create(stock({ currentValue: 1_250_001 }), { "idempotency-key": "mk" });
      expect(clash.status).toBe(409);
    });

    it("starts the value at the amount put in, and keeps the first value in the history", async () => {
      const res = await create(stock());
      const data = (await res.json()).data;
      expect(data).toMatchObject({ value: 1_000_000, gain: 0, gainPercent: 0 });
      const { GET } = await import("@/app/api/integrations/holdings/[id]/route");
      const one = (await (await GET(req(`holdings/${data.id}`, "GET"), ctx(data.id))).json()).data;
      expect(one.history).toHaveLength(1);
      expect(one.history[0].value).toBe(1_000_000);
    });

    it("rejects bad bodies and a missing key", async () => {
      const bad: Record<string, unknown>[] = [
        stock({ name: "" }),
        stock({ kind: "crypto" }),
        stock({ investedAmount: undefined }),
        stock({ investedAmount: -1 }),
        stock({ investedAmount: 10.5 }),
        stock({ investedAmount: 1e13 + 1 }),
        stock({ currentValue: 1e13 + 1 }),
        stock({ units: "abc" }),
        stock({ units: "1.1234567" }),
        stock({ units: "-3" }),
        stock({ units: "1000000001" }),
        stock({ sip: { amount: 5000, dayOfMonth: 32, startDay: "2026-01-05" } }),
        stock({ sip: { amount: 0, dayOfMonth: 5, startDay: "2026-01-05" } }),
        stock({ sip: { amount: 5000, dayOfMonth: 5, startDay: "2026-02-30" } }),
        stock({ fd: deposit().fd }),
        deposit({ fd: undefined }),
        deposit({ units: "1" }),
        deposit({ investedAmount: 5 }),
        deposit({ sip: { amount: 5000, dayOfMonth: 5, startDay: "2026-01-05" } }),
        deposit({ fd: { principal: 10_000_000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2026-01-01" } }),
        deposit({ fd: { principal: 10_000_000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2026-01-05x" } }),
        deposit({ fd: { principal: 1e12, rateBps: 10_000, startDay: "2026-01-01", maturityDay: "2076-01-01" } }),
        deposit({ fd: { principal: 10_000_000, rateBps: 10_001, startDay: "2026-01-01", maturityDay: "2027-01-01" } }),
        deposit({ fd: { principal: 10_000_000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2100-01-01" } }),
      ];
      for (const body of bad) expect((await create(body)).status, JSON.stringify(body)).toBe(400);
      const { POST } = await import("@/app/api/integrations/holdings/route");
      const noKey = new NextRequest("http://localhost/api/integrations/holdings", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(stock()),
      });
      expect((await POST(noKey, {})).status).toBe(400);
    });

    it("locks the base currency, and refuses a base that is not two decimal without locking it", async () => {
      const { default: User } = await import("@/models/User");
      await create(stock());
      expect((await User.findById(userId).lean<{ baseLocked?: boolean }>())?.baseLocked).toBe(true);

      await User.updateOne({ _id: otherId }, { $set: { "preferences.currency": "JPY" } });
      const { default: ApiKey } = await import("@/models/ApiKey");
      const { hashKey } = await import("@/lib/integrations/auth");
      const key2 = "test-holdings-api-key-jpy";
      await ApiKey.create({ user: otherId, label: "phone", keyHash: hashKey(key2), lastFour: key2.slice(-4) });
      const { POST } = await import("@/app/api/integrations/holdings/route");
      const res = await POST(req("holdings", "POST", stock(), { authorization: `Bearer ${key2}` }), {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BASE_CURRENCY_ONLY_TWO_DECIMALS");
      expect(body.error.details.errorCode).toBe("UNSUPPORTED_BASE_CURRENCY");
      expect((await User.findById(otherId).lean<{ baseLocked?: boolean }>())?.baseLocked).toBeFalsy();
    });

    it("a holding counts as money data: the base can no longer change", async () => {
      const { setBaseCurrency } = await import("@/lib/base-currency");
      await create(stock());
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: userId }, { $unset: { baseLocked: "" } }); // as an account from before the flag existed
      await expect(setBaseCurrency(userId, "USD")).rejects.toMatchObject({ code: "HAS_MONEY_DATA" });
    });

    it("keeps at most 500 holdings", async () => {
      const { default: Holding } = await import("@/models/Holding");
      await Holding.insertMany(
        Array.from({ length: 500 }, (_, i) => ({ user: userId, name: `H${i}`, kind: "other", investedAmount: 1, currentValue: 1 }))
      );
      const res = await create(stock());
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.details.errorCode).toBe("HOLDING_LIMIT");
      expect(await Holding.countDocuments({ user: userId })).toBe(500);
      // archiving one frees a place
      await Holding.updateOne({ user: userId, name: "H0" }, { $set: { isArchived: true } });
      expect((await create(stock())).status).toBe(201);
    });
  });

  describe("list", () => {
    it("totals, breaks down by kind, and leaves out archived and other people's holdings", async () => {
      const { GET } = await import("@/app/api/integrations/holdings/route");
      const { default: Holding } = await import("@/models/Holding");
      await create(stock({ name: "A", investedAmount: 100_000, currentValue: 150_000 }));
      await create(stock({ name: "B", kind: "mutual_fund", investedAmount: 200_000, currentValue: 180_000 }));
      await create(stock({ name: "C", kind: "stock", investedAmount: 50_000, currentValue: 50_000 }));
      const gone = await idOf(await create(stock({ name: "Gone", investedAmount: 999_999 })));
      await Holding.updateOne({ _id: gone }, { $set: { isArchived: true } });
      await Holding.create({ user: otherId, name: "Theirs", kind: "gold", investedAmount: 777, currentValue: 888 });

      const res = await GET(req("holdings", "GET"), {});
      const { data } = await res.json();
      expect(data.holdings.map((h: { name: string }) => h.name).sort()).toEqual(["A", "B", "C"]);
      expect(data.totals).toMatchObject({ count: 3, invested: 350_000, value: 380_000, gain: 30_000, gainPercent: 8.6 });
      expect(data.byKind).toEqual([
        { kind: "stock", count: 2, invested: 150_000, value: 200_000, gain: 50_000 },
        { kind: "mutual_fund", count: 1, invested: 200_000, value: 180_000, gain: -20_000 },
      ]);
      expect(data.holdings.find((h: { name: string }) => h.name === "B")).toMatchObject({ gain: -20_000, gainPercent: -10 });
    });

    it("an empty account has zero totals and a null percent", async () => {
      const { GET } = await import("@/app/api/integrations/holdings/route");
      const { data } = await (await GET(req("holdings", "GET"), {})).json();
      expect(data).toMatchObject({ holdings: [], byKind: [], upcomingSips: [], totals: { count: 0, invested: 0, value: 0, gain: 0, gainPercent: null } });
    });

    it("works out a fixed deposit from its terms as of the day", async () => {
      const { listHoldings } = await import("@/lib/holding-service");
      await create(deposit());
      // 2026-07-02 in Kolkata: 182 days in
      const half = (await listHoldings(userId, new Date("2026-07-02T06:00:00Z"))).holdings[0];
      expect(half.fd).toMatchObject({ accrued: 361_507, maturityValue: 10_725_000, termDays: 365, daysToMaturity: 183, matured: false });
      expect(half).toMatchObject({ invested: 10_000_000, value: 10_361_507, gain: 361_507 });
      const done = (await listHoldings(userId, new Date("2027-03-01T06:00:00Z"))).holdings[0];
      expect(done).toMatchObject({ value: 10_725_000, gain: 725_000 });
      expect(done.fd).toMatchObject({ matured: true, daysToMaturity: 0 });
      const before = (await listHoldings(userId, new Date("2025-06-01T06:00:00Z"))).holdings[0];
      expect(before).toMatchObject({ value: 10_000_000, gain: 0 });
    });

    it("uses the person's own time zone for today", async () => {
      const { default: User } = await import("@/models/User");
      const { listHoldings } = await import("@/lib/holding-service");
      await create(deposit());
      // 2026-07-01 20:00 UTC is already 2026-07-02 in Kolkata and still 07-01 in New York
      const instant = new Date("2026-07-01T20:00:00Z");
      expect((await listHoldings(userId, instant)).holdings[0].fd?.daysToMaturity).toBe(183);
      await User.updateOne({ _id: userId }, { $set: { "preferences.timezone": "America/New_York" } });
      expect((await listHoldings(userId, instant)).holdings[0].fd?.daysToMaturity).toBe(184);
    });
  });

  describe("value", () => {
    it("records a total, moves the gain and keeps a history", async () => {
      const id = await idOf(await create(stock()));
      const res = await setValue(id, { value: 1_300_000 });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ value: 1_300_000, gain: 300_000, gainPercent: 30 });
      await setValue(id, { value: 900_000 });
      const { GET } = await import("@/app/api/integrations/holdings/[id]/route");
      const one = (await (await GET(req(`holdings/${id}`, "GET"), ctx(id))).json()).data;
      expect(one.history.map((h: { value: number }) => h.value)).toEqual([900_000, 1_300_000, 1_000_000]);
    });

    it("a price times the units is exact and rounds half up", async () => {
      const id = await idOf(await create(stock({ units: "12.5" })));
      const res = await setValue(id, { price: "123.4567" });
      expect((await res.json()).data.value).toBe(154_321);
      const third = await idOf(await create(stock({ name: "Tenth", units: "3" })));
      expect((await (await setValue(third, { price: "0.1" })).json()).data.value).toBe(30);
    });

    it("refuses a price without units, both forms, neither, bad numbers and a fixed deposit", async () => {
      const noUnits = await idOf(await create(stock({ units: undefined })));
      const r1 = await setValue(noUnits, { price: "10" });
      expect(r1.status).toBe(400);
      expect((await r1.json()).error.details.errorCode).toBe("UNITS_REQUIRED");
      const id = await idOf(await create(stock()));
      expect((await setValue(id, { value: 1, price: "1" })).status).toBe(400);
      expect((await setValue(id, {})).status).toBe(400);
      expect((await setValue(id, { value: -1 })).status).toBe(400);
      expect((await setValue(id, { value: 1.5 })).status).toBe(400);
      expect((await setValue(id, { value: 1e13 + 1 })).status).toBe(400);
      expect((await setValue(id, { price: "1.23456" })).status).toBe(400);
      expect((await setValue(id, { price: "abc" })).status).toBe(400);
      const fd = await idOf(await create(deposit()));
      const r2 = await setValue(fd, { value: 5 });
      expect(r2.status).toBe(400);
      expect((await r2.json()).error.details.errorCode).toBe("VALUE_NOT_SETTABLE");
    });

    it("a price that would pass the limit is refused", async () => {
      const id = await idOf(await create(stock({ units: "1000000000" })));
      const res = await setValue(id, { price: "1000000" });
      expect(res.status).toBe(400);
    });

    it("keeps only the last 100 values", async () => {
      const id = await idOf(await create(stock()));
      for (let i = 1; i <= 104; i++) await setValue(id, { value: 1_000_000 + i });
      const { GET } = await import("@/app/api/integrations/holdings/[id]/route");
      const one = (await (await GET(req(`holdings/${id}`, "GET"), ctx(id))).json()).data;
      expect(one.history).toHaveLength(100);
      expect(one.history[0].value).toBe(1_000_104);
      expect(one.history[99].value).toBe(1_000_005);
    });

    it("replays on the same key without a second history entry", async () => {
      const id = await idOf(await create(stock()));
      const { POST } = await import("@/app/api/integrations/holdings/[id]/value/route");
      const call = () => POST(req(`holdings/${id}/value`, "POST", { value: 1_100_000 }, { "idempotency-key": "same-value" }), ctx(id));
      expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(200);
      const { default: Holding } = await import("@/models/Holding");
      expect((await Holding.findById(id).lean<{ history: unknown[] }>())?.history).toHaveLength(2);
    });
  });

  describe("update and archive", () => {
    it("changes the name, clears units and the SIP, and keeps the value", async () => {
      const { PATCH } = await import("@/app/api/integrations/holdings/[id]/route");
      const id = await idOf(await create(stock({ sip: { amount: 500_000, dayOfMonth: 5, startDay: "2026-01-05" }, currentValue: 1_200_000 })));
      const res = await PATCH(req(`holdings/${id}`, "PATCH", { name: "Infosys Ltd", units: null, sip: null, note: "long term", investedAmount: 1_100_000 }), ctx(id));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ name: "Infosys Ltd", units: null, sip: null, note: "long term", invested: 1_100_000, value: 1_200_000, gain: 100_000 });
      const cleared = await PATCH(req(`holdings/${id}`, "PATCH", { note: null }), ctx(id));
      expect((await cleared.json()).data.note).toBeNull();
    });

    it("changes a fixed deposit's terms but never its units, invested amount or SIP", async () => {
      const { PATCH } = await import("@/app/api/integrations/holdings/[id]/route");
      const id = await idOf(await create(deposit()));
      const ok = await PATCH(
        req(`holdings/${id}`, "PATCH", { fd: { principal: 20_000_000, rateBps: 700, startDay: "2026-01-01", maturityDay: "2028-01-01" } }),
        ctx(id)
      );
      expect((await ok.json()).data).toMatchObject({ invested: 20_000_000, fd: { principal: 20_000_000, termDays: 730 } });
      for (const body of [{ units: "5" }, { investedAmount: 1 }, { sip: { amount: 1, dayOfMonth: 1, startDay: "2026-01-01" } }]) {
        const res = await PATCH(req(`holdings/${id}`, "PATCH", body), ctx(id));
        expect(res.status).toBe(400);
        expect((await res.json()).error.details.errorCode).toBe("NOT_ALLOWED");
      }
      const plain = await idOf(await create(stock()));
      const res = await PATCH(req(`holdings/${plain}`, "PATCH", { fd: deposit().fd }), ctx(plain));
      expect(res.status).toBe(400);
    });

    it("rejects an empty or invalid change", async () => {
      const { PATCH } = await import("@/app/api/integrations/holdings/[id]/route");
      const id = await idOf(await create(stock()));
      for (const body of [{}, { name: "" }, { units: "x" }, { investedAmount: -5 }, { sip: { amount: 1, dayOfMonth: 40, startDay: "2026-01-01" } }]) {
        expect((await PATCH(req(`holdings/${id}`, "PATCH", body), ctx(id))).status, JSON.stringify(body)).toBe(400);
      }
      expect((await PATCH(req("holdings/not-an-id", "PATCH", { name: "x" }), ctx("not-an-id"))).status).toBe(400);
    });

    it("DELETE archives: gone from the list and the net worth, and not found afterwards", async () => {
      const { DELETE, GET } = await import("@/app/api/integrations/holdings/[id]/route");
      const { default: Holding } = await import("@/models/Holding");
      const id = await idOf(await create(stock()));
      const res = await DELETE(req(`holdings/${id}`, "DELETE"), ctx(id));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ id, deleted: true });
      expect((await Holding.findById(id).lean<{ isArchived: boolean }>())?.isArchived).toBe(true);
      expect((await GET(req(`holdings/${id}`, "GET"), ctx(id))).status).toBe(404);
      expect((await DELETE(req(`holdings/${id}`, "DELETE"), ctx(id))).status).toBe(404);
      const list = await (await (await import("@/app/api/integrations/holdings/route")).GET(req("holdings", "GET"), {})).json();
      expect(list.data.holdings).toEqual([]);
    });

    it("never reads or changes another person's holding", async () => {
      const { default: Holding } = await import("@/models/Holding");
      const theirs = String(
        (await Holding.create({ user: otherId, name: "Theirs", kind: "gold", investedAmount: 100, currentValue: 100, unitsMicro: 1_000_000 }))._id
      );
      const { GET, PATCH, DELETE } = await import("@/app/api/integrations/holdings/[id]/route");
      expect((await GET(req(`holdings/${theirs}`, "GET"), ctx(theirs))).status).toBe(404);
      expect((await PATCH(req(`holdings/${theirs}`, "PATCH", { name: "Mine now" }), ctx(theirs))).status).toBe(404);
      expect((await setValue(theirs, { value: 5 })).status).toBe(404);
      expect((await setValue(theirs, { price: "5" })).status).toBe(404);
      expect((await DELETE(req(`holdings/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);
      const after = await Holding.findById(theirs).lean<{ name: string; currentValue: number; isArchived: boolean }>();
      expect(after).toMatchObject({ name: "Theirs", currentValue: 100, isArchived: false });
    });
  });

  describe("SIPs", () => {
    it("lists the due dates of active SIPs soonest first, and not a paused one", async () => {
      const { listSips } = await import("@/lib/holding-service");
      await create(stock({ name: "Monthly 31st", sip: { amount: 500_000, dayOfMonth: 31, startDay: "2026-01-31" } }));
      await create(stock({ name: "Monthly 5th", sip: { amount: 200_000, dayOfMonth: 5, startDay: "2026-01-05" } }));
      await create(stock({ name: "Paused", sip: { amount: 100_000, dayOfMonth: 10, startDay: "2026-01-10", active: false } }));
      const { sips } = await listSips(userId, new Date("2026-02-03T06:00:00Z"));
      expect(sips.map((s) => [s.name, s.date, s.amount])).toEqual([
        ["Monthly 5th", "2026-02-05", 200_000],
        ["Monthly 31st", "2026-02-28", 500_000],
        ["Monthly 5th", "2026-03-05", 200_000],
        ["Monthly 31st", "2026-03-31", 500_000],
      ]);
    });

    it("GET .../sips and the list answer carry them, and each holding has its next due date", async () => {
      const { GET } = await import("@/app/api/integrations/holdings/sips/route");
      const list = await import("@/app/api/integrations/holdings/route");
      await create(stock({ name: "SIP", sip: { amount: 500_000, dayOfMonth: 15, startDay: "2020-01-15" } }));
      const sips = (await (await GET(req("holdings/sips", "GET"), {})).json()).data.sips;
      expect(sips.length).toBeGreaterThanOrEqual(1);
      expect(sips[0]).toMatchObject({ name: "SIP", amount: 500_000 });
      const data = (await (await list.GET(req("holdings", "GET"), {})).json()).data;
      expect(data.upcomingSips.length).toBe(sips.length);
      expect(data.holdings[0].sip.nextDue).toBe(sips[0].date);
    });
  });

  describe("net worth", () => {
    it("counts holdings (fixed deposits at today's value) as assets and leaves archived ones out", async () => {
      const { computeNetWorth } = await import("@/lib/net-worth");
      const { default: Holding } = await import("@/models/Holding");
      const { default: ManualAsset } = await import("@/models/ManualAsset");
      await ManualAsset.create({ user: userId, name: "Flat", kind: "property", value: 5_000_000 });
      await create(stock({ currentValue: 1_250_000 }));
      await create(deposit());
      const gone = await idOf(await create(stock({ name: "Gone", investedAmount: 777_777 })));
      await Holding.updateOne({ _id: gone }, { $set: { isArchived: true } });
      await Holding.create({ user: otherId, name: "Theirs", kind: "gold", investedAmount: 9_999, currentValue: 9_999 });

      const nw = await computeNetWorth(userId, new Date("2026-07-02T06:00:00Z"));
      const row = nw.breakdown.assets.find((r) => r.key === "holdings");
      expect(row).toEqual({ key: "holdings", label: "Holdings", amount: 1_250_000 + 10_361_507, count: 2 });
      expect(nw.breakdown.assets.find((r) => r.key === "manual")?.amount).toBe(5_000_000);
      expect(nw.assets).toBe(5_000_000 + 1_250_000 + 10_361_507);
      expect(nw.netWorth).toBe(nw.assets);
    });

    it("an investment-type account is counted on its own, as before", async () => {
      const { computeNetWorth } = await import("@/lib/net-worth");
      const { default: Account } = await import("@/models/Account");
      await Account.create({ user: userId, name: "Broker cash", type: "investment", balance: 300_000 });
      await create(stock({ currentValue: 100_000, investedAmount: 100_000 }));
      const nw = await computeNetWorth(userId);
      expect(nw.breakdown.assets.find((r) => r.key === "investment")?.amount).toBe(300_000);
      expect(nw.breakdown.assets.find((r) => r.key === "holdings")?.amount).toBe(100_000);
    });
  });

  describe("browser routes (/api/holdings)", () => {
    const browser = (path: string, method: string, body?: unknown) =>
      new NextRequest(`http://localhost/api/holdings${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it("needs a signed-in user", async () => {
      const { GET } = await import("@/app/api/holdings/route");
      expect((await GET()).status).toBe(401);
    });

    it("lists, creates, edits, records a value and archives", async () => {
      sessionUser.current = { id: userId, name: "H", email: "h@x.com", role: "user" };
      const list = await import("@/app/api/holdings/route");
      const one = await import("@/app/api/holdings/[id]/route");
      const value = await import("@/app/api/holdings/[id]/value/route");
      const made = await list.POST(browser("", "POST", stock({ units: "2" })));
      expect(made.status).toBe(201);
      const id = (await made.json()).data.id as string;
      expect((await list.POST(browser("", "POST", stock({ kind: "nope" })))).status).toBe(400);
      expect((await one.PATCH(browser(`/${id}`, "PATCH", { name: "Renamed" }), ctx(id))).status).toBe(200);
      const priced = await value.POST(browser(`/${id}/value`, "POST", { price: "700" }), ctx(id));
      expect((await priced.json()).data.value).toBe(140_000);
      expect((await (await list.GET()).json()).data.totals.count).toBe(1);
      expect((await one.DELETE(browser(`/${id}`, "DELETE"), ctx(id))).status).toBe(200);
      expect((await one.GET(browser(`/${id}`, "GET"), ctx(id))).status).toBe(404);
      expect((await one.GET(browser("/zzz", "GET"), ctx("zzz"))).status).toBe(400);
    });

    it("never reaches another person's holding", async () => {
      const { default: Holding } = await import("@/models/Holding");
      const theirs = String((await Holding.create({ user: otherId, name: "Theirs", kind: "gold", investedAmount: 1, currentValue: 1 }))._id);
      sessionUser.current = { id: userId, name: "H", email: "h@x.com", role: "user" };
      const one = await import("@/app/api/holdings/[id]/route");
      expect((await one.GET(browser(`/${theirs}`, "GET"), ctx(theirs))).status).toBe(404);
      expect((await one.DELETE(browser(`/${theirs}`, "DELETE"), ctx(theirs))).status).toBe(404);
    });
  });
});
