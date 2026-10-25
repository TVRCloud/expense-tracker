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

const KEY_O = "test-household-key-owner";
const KEY_M = "test-household-key-member";
const KEY_S = "test-household-key-stranger";
const KEY_X = "test-household-key-second-member";

type Who = "o" | "m" | "s" | "x";
const KEYS: Record<Who, string> = { o: KEY_O, m: KEY_M, s: KEY_S, x: KEY_X };

describe("household sharing", () => {
  let ids: Record<Who, string>;
  let emails: Record<Who, string>;
  let a1: string; // shared
  let a2: string; // never shared
  let counter = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { default: Account } = await import("@/models/Account");
    const { hashKey } = await import("@/lib/integrations/auth");
    const tag = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    emails = { o: `owner${tag}@x.com`, m: `member${tag}@x.com`, s: `stranger${tag}@x.com`, x: `second${tag}@x.com` };
    ids = {} as Record<Who, string>;
    for (const who of ["o", "m", "s", "x"] as Who[]) {
      const u = await User.create({ name: `Name-${who}`, email: emails[who], password: "hash", isActive: true });
      ids[who] = u._id.toString();
      await ApiKey.create({ user: u._id, label: "phone", keyHash: hashKey(KEYS[who]), lastFour: KEYS[who].slice(-4) });
    }
    const x1 = await Account.create({ user: ids.o, name: "Joint", type: "bank", balance: 100000 });
    const x2 = await Account.create({ user: ids.o, name: "Secret savings", type: "savings", balance: 999000 });
    a1 = x1._id.toString();
    a2 = x2._id.toString();
  });

  // ── helpers ──
  function req(path: string, who: Who, init: { method?: string; body?: unknown; idem?: string | null } = {}) {
    counter += 1;
    const idem = init.idem === undefined ? `k-${counter}` : init.idem;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${KEYS[who]}`,
        "content-type": "application/json",
        ...(idem && init.method && init.method !== "GET" ? { "idempotency-key": idem } : {}),
      },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });
  }
  const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
  type Res = { status: number; json: () => Promise<{ success: boolean; data?: any; error?: { code: string; message: string; reason?: string }; requestId?: string }> }; // eslint-disable-line @typescript-eslint/no-explicit-any

  async function invite(body: Record<string, unknown> = {}, who: Who = "o", idem?: string | null): Promise<Res> {
    const { POST } = await import("@/app/api/integrations/shares/route");
    return POST(req("shares", who, { method: "POST", idem, body: { email: emails.m, accountIds: [a1], role: "viewer", includeBudgets: false, ...body } }), {});
  }
  async function accept(id: string, code: unknown, who: Who = "m", idem?: string): Promise<Res> {
    const { POST } = await import("@/app/api/integrations/shares/[id]/accept/route");
    return POST(req(`shares/${id}/accept`, who, { method: "POST", body: { code }, idem }), params({ id }));
  }
  async function listShares(who: Who) {
    const { GET } = await import("@/app/api/integrations/shares/route");
    const res = (await GET(req("shares", who), {})) as Res;
    return (await res.json()).data as { owned: any[]; received: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  /** Owner invites the member and the member accepts: an active share. */
  async function activeShare(body: Record<string, unknown> = {}, who: Who = "m") {
    const res = await invite({ email: emails[who], ...body });
    const data = (await res.json()).data;
    const ok = await accept(data.share.id, data.code, who);
    expect(ok.status).toBe(200);
    return data.share.id as string;
  }
  async function shared(route: "accounts" | "transactions" | "budgets" | "summary", who: Who = "m", query = "", ownerId = ids.o) {
    const mod = await import(`@/app/api/integrations/shared/[ownerId]/${route}/route`);
    const res = (await mod.GET(req(`shared/${ownerId}/${route}${query}`, who), params({ ownerId }))) as Res;
    return { status: res.status, body: await res.json() };
  }
  async function sharedPost(body: unknown, who: Who = "m", idem?: string | null) {
    const { POST } = await import("@/app/api/integrations/shared/[ownerId]/transactions/route");
    const res = (await POST(req(`shared/${ids.o}/transactions`, who, { method: "POST", body, idem }), params({ ownerId: ids.o }))) as Res;
    return { status: res.status, body: await res.json() };
  }
  async function endShare(id: string, who: Who) {
    const { DELETE } = await import("@/app/api/integrations/shares/[id]/route");
    return (await DELETE(req(`shares/${id}`, who, { method: "DELETE" }), params({ id }))) as Res;
  }

  async function seedData() {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Budget } = await import("@/models/Budget");
    const now = new Date();
    const mk = (over: Record<string, unknown>) =>
      Transaction.create({
        user: ids.o,
        account: a1,
        type: "expense",
        amount: 1000,
        category: "Food",
        date: now,
        description: "lunch",
        note: "OWNER-PRIVATE-NOTE",
        tags: ["private-tag"],
        attachments: ["receipt-id-1"],
        source: "sms",
        ...over,
      });
    const food = await mk({ amount: 2500, description: "joint dinner" });
    await mk({ type: "income", amount: 10000, category: "Salary", description: "pay" });
    await mk({ account: a2, amount: 77777, description: "SECRET-ONLY-ON-A2", category: "Gifts" });
    await mk({ type: "transfer", amount: 3000, category: "Transfer", transferTo: a2, description: "to savings" });
    await mk({ account: a2, type: "transfer", amount: 4000, category: "Transfer", transferTo: a1, description: "from savings" });
    await mk({ amount: 555, description: "voided one", reviewStatus: "voided" });
    await mk({ amount: 556, description: "deleted one", isDeleted: true });
    await mk({ type: "income", amount: 500, category: "Food", description: "refund", refundOf: food._id, refundStatus: "confirmed" });
    const d = new Date();
    await Budget.create({ user: ids.o, category: "Food", month: d.getMonth() + 1, year: d.getFullYear(), limitAmount: 50000 });
  }

  // ── invites ──
  describe("invite", () => {
    it("returns the code once, stores only its hash and never lists it", async () => {
      const res = await invite({}, "o", "same-key");
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.share.status).toBe("pending");
      expect(typeof data.code).toBe("string");
      expect(data.code.length).toBeGreaterThanOrEqual(40);
      expect(JSON.stringify(data.share)).not.toContain(data.code);

      const { default: Share } = await import("@/models/Share");
      const row = await Share.findById(data.share.id).lean<{ inviteTokenHash: string }>();
      expect(row!.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.inviteTokenHash).not.toContain(data.code);
      expect(JSON.stringify(row)).not.toContain(data.code);

      // The stored idempotency answer never holds the code either.
      const { default: IdempotencyRecord } = await import("@/models/IdempotencyRecord");
      const records = await IdempotencyRecord.find({}).lean();
      expect(JSON.stringify(records)).not.toContain(data.code);

      // A retry replays the share without repeating the code.
      const again = await invite({}, "o", "same-key");
      expect(again.status).toBe(201);
      const replay = (await again.json()).data;
      expect(replay.share.id).toBe(data.share.id);
      expect(replay.code).toBeUndefined();

      const mine = await listShares("o");
      expect(JSON.stringify(mine)).not.toContain(data.code);
      expect(JSON.stringify(mine)).not.toContain(row!.inviteTokenHash);
    });

    it("needs an Idempotency-Key and a valid body", async () => {
      expect((await invite({}, "o", null)).status).toBe(400);
      expect((await invite({ email: "not-an-email" })).status).toBe(400);
      expect((await invite({ accountIds: [] })).status).toBe(400);
      expect((await invite({ role: "admin" })).status).toBe(400);
    });

    it("only your own live accounts, never yourself, one live share per address", async () => {
      const { default: Account } = await import("@/models/Account");
      const theirs = await Account.create({ user: ids.s, name: "Theirs", type: "bank" });
      const archived = await Account.create({ user: ids.o, name: "Old", type: "bank", isArchived: true });
      expect((await invite({ accountIds: [theirs._id.toString()] })).status).toBe(400);
      expect((await invite({ accountIds: [archived._id.toString()] })).status).toBe(400);
      expect((await invite({ accountIds: ["000000000000000000000000"] })).status).toBe(400);
      expect((await invite({ accountIds: [a1, a1] })).status).toBe(400);
      expect((await invite({ email: emails.o })).status).toBe(400);
      expect((await invite()).status).toBe(201);
      const second = await invite();
      expect(second.status).toBe(409);
      expect((await second.json()).error!.reason).toBe("ALREADY_SHARED");
    });

    it("limits shares per owner and per account", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await invite({ email: `friend${i}@x.com` });
        expect(res.status).toBe(201);
      }
      const sixth = await invite({ email: "friend5@x.com" });
      expect(sixth.status).toBe(409);
      expect((await sixth.json()).error!.reason).toBe("LIMIT_REACHED");
      // Another account is still open to the same owner, up to 10 live shares.
      for (let i = 5; i < 10; i++) expect((await invite({ email: `friend${i}@x.com`, accountIds: [a2] })).status).toBe(201);
      expect((await invite({ email: "friend10@x.com", accountIds: [a2] })).status).toBe(409);
    });

    it("the owner's list cannot tell a registered address from an unregistered one", async () => {
      await invite({ email: emails.s }); // registered, name "Name-s"
      await invite({ email: "nobody-here@x.com" });
      const { default: User } = await import("@/models/User");
      await User.create({ name: "Gone", email: "gone@x.com", password: "h", isActive: false });
      await invite({ email: "gone@x.com" });
      const owned = (await listShares("o")).owned as { member: { email: string; name: string | null }; status: string }[];
      expect(owned).toHaveLength(3);
      for (const o of owned) {
        expect(o.status).toBe("pending");
        expect(o.member.name).toBeNull();
      }
      expect(JSON.stringify(owned)).not.toMatch(/Name-s|Gone/);
      // The same through the create answer and the browser list.
      const created = (await (await invite({ email: emails.x })).json()).data.share;
      expect(created.member.name).toBeNull();
      // Once accepted, the member's name shows (they chose to join).
      const id = await activeShare({ email: emails.m });
      const after = (await listShares("o")).owned as { id: string; member: { name: string | null } }[];
      expect(after.find((o) => o.id === id)!.member.name).toBe("Name-m");
    });

    it("limits hold when invites race", async () => {
      const { default: Share } = await import("@/models/Share");
      // Four live shares on the joint account already (the limit is five).
      await Share.insertMany(
        Array.from({ length: 4 }, (_, i) => ({ owner: ids.o, memberEmail: `seed${i}@x.com`, accountIds: [a1], status: "pending", inviteExpiresAt: new Date(Date.now() + 1e9) }))
      );
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => invite({ email: `racer${i}@x.com` })));
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(await Share.countDocuments({ owner: ids.o, accountIds: a1, status: { $in: ["pending", "active"] } })).toBeLessThanOrEqual(5);

      // The per-owner limit (ten) the same way: eight live on the other account, then a race on the joint one.
      await Share.deleteMany({});
      await Share.insertMany(
        Array.from({ length: 8 }, (_, i) => ({ owner: ids.o, memberEmail: `held${i}@x.com`, accountIds: [a2], status: "pending", inviteExpiresAt: new Date(Date.now() + 1e9) }))
      );
      const more = await Promise.all(Array.from({ length: 5 }, (_, i) => invite({ email: `late${i}@x.com` })));
      expect(more.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(await Share.countDocuments({ owner: ids.o, status: { $in: ["pending", "active"] } })).toBeLessThanOrEqual(10);
    });

    describe("the limit post-check", () => {
      // Real first call (the pre-check), then the post-check sees a crowd or fails.
      async function postCheck(result: "over" | "throws") {
        const { default: Share } = await import("@/models/Share");
        const orig = Share.aggregate.bind(Share);
        let n = 0;
        return vi.spyOn(Share, "aggregate").mockImplementation(((...args: unknown[]) => {
          n += 1;
          if (n === 1) return (orig as (...a: unknown[]) => unknown)(...args);
          return result === "over" ? Promise.resolve([{ _id: a1, n: 99 }]) : Promise.reject(new Error("db down"));
        }) as never);
      }

      it("an invite that turns out over the limit is taken back", async () => {
        const spy = await postCheck("over");
        const res = await invite();
        spy.mockRestore();
        expect(res.status).toBe(409);
        expect((await res.json()).error!.reason).toBe("LIMIT_REACHED");
        const { default: Share } = await import("@/models/Share");
        expect(await Share.countDocuments({})).toBe(0);
        expect((await invite()).status).toBe(201); // the slot and the unique address are free again
      });

      it("an invite whose post-check fails is taken back too", async () => {
        const spy = await postCheck("throws");
        const { createInvite, shareInviteSchema } = await import("@/lib/share-service");
        const input = shareInviteSchema.parse({ email: emails.m, accountIds: [a1] });
        await expect(createInvite({ id: ids.o, name: "Name-o", email: emails.o }, input)).rejects.toThrow("db down");
        spy.mockRestore();
        const { default: Share } = await import("@/models/Share");
        expect(await Share.countDocuments({})).toBe(0);
      });

      it("taking back an over-limit invite is retried when the first delete fails", async () => {
        const spy = await postCheck("over");
        const { default: Share } = await import("@/models/Share");
        const realDelete = Share.deleteOne.bind(Share);
        let calls = 0;
        const del = vi.spyOn(Share, "deleteOne").mockImplementation(((...args: unknown[]) => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error("blip")) : (realDelete as (...a: unknown[]) => unknown)(...args);
        }) as never);
        const res = await invite();
        del.mockRestore();
        spy.mockRestore();
        expect(res.status).toBe(409);
        expect(calls).toBe(2);
        expect(await Share.countDocuments({})).toBe(0);
      });

      it("a refused change puts back the role and budgets as well as the accounts", async () => {
        const id = await activeShare({ role: "viewer", includeBudgets: false });
        const { default: Share } = await import("@/models/Share");
        const { PATCH } = await import("@/app/api/integrations/shares/[id]/route");
        const spy = await postCheck("over");
        const res = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { accountIds: [a2], role: "editor", includeBudgets: true } }), params({ id }))) as Res;
        spy.mockRestore();
        expect(res.status).toBe(409);
        const row = await Share.findById(id).lean<{ role: string; includeBudgets: boolean; accountIds: unknown[] }>();
        expect(row!.role).toBe("viewer");
        expect(row!.includeBudgets).toBe(false);
        expect(row!.accountIds.map(String)).toEqual([a1]);
      });

      it("a change whose post-check fails is put back and the error surfaces", async () => {
        const id = await activeShare({ role: "viewer" });
        const { default: Share } = await import("@/models/Share");
        const { updateShare } = await import("@/lib/share-service");
        const spy = await postCheck("throws");
        await expect(updateShare(ids.o, id, { accountIds: [a2], role: "editor", includeBudgets: true })).rejects.toThrow("db down");
        spy.mockRestore();
        const row = await Share.findById(id).lean<{ role: string; includeBudgets: boolean; accountIds: unknown[] }>();
        expect(row).toMatchObject({ role: "viewer", includeBudgets: false });
        expect(row!.accountIds.map(String)).toEqual([a1]);
      });
    });

    it("every share 404 has the same shape", async () => {
      const { shareErrorResponse } = await import("@/lib/integrations/share-http");
      const { ShareServiceError } = await import("@/lib/share-service");
      const viaService = shareErrorResponse(new ShareServiceError("NOT_FOUND", "Not found"), "rid")!;
      const viaAccess = (await shared("accounts", "s")).body;
      expect(viaService.status).toBe(404);
      const a = await viaService.json();
      expect(a).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Not found" }, requestId: "rid" });
      expect(Object.keys(viaAccess.error!)).toEqual(Object.keys(a.error));
      expect(viaAccess.error).toEqual(a.error);
    });

    it("a replayed accept is a 404 once the owner's account is gone", async () => {
      const { data } = await (await invite()).json();
      expect((await accept(data.share.id, data.code, "m", "own-1")).status).toBe(200);
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: ids.o }, { $set: { isActive: false } });
      expect((await accept(data.share.id, data.code, "m", "own-1")).status).toBe(404);
    });

    it("access is checked before the body: a non-member gets 404 for a bad body, a member 400", async () => {
      await activeShare({ role: "editor" });
      expect((await sharedPost("{nope", "s")).status).toBe(404);
      expect((await sharedPost("{nope", "m")).status).toBe(400);
      expect((await sharedPost({ accountId: "x" }, "s")).status).toBe(404);
    });

    it("tells a registered invitee in the app, without the code", async () => {
      const res = await invite();
      const { data } = await res.json();
      const { default: Notification } = await import("@/models/Notification");
      // Sent after the answer, so wait for it.
      let rows = await Notification.find({ user: ids.m }).lean();
      for (let i = 0; i < 20 && rows.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
        rows = await Notification.find({ user: ids.m }).lean();
      }
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(data.code);
      expect((rows[0].meta as { kind: string }).kind).toBe("household_invite");
    });

    it("an expired pending invite frees the slot and cannot be accepted", async () => {
      const first = await (await invite()).json();
      const { default: Share } = await import("@/models/Share");
      await Share.updateOne({ _id: first.data.share.id }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } });
      expect((await accept(first.data.share.id, first.data.code)).status).toBe(404);
      const owned = (await listShares("o")).owned;
      expect(owned).toHaveLength(0);
      expect((await invite()).status).toBe(201);
    });

    it("a lost code can be replaced; the old one stops working", async () => {
      const first = await (await invite()).json();
      const { POST } = await import("@/app/api/integrations/shares/[id]/code/route");
      const res = (await POST(req(`shares/${first.data.share.id}/code`, "o", { method: "POST" }), params({ id: first.data.share.id }))) as Res;
      expect(res.status).toBe(200);
      const fresh = (await res.json()).data;
      expect(fresh.code).not.toBe(first.data.code);
      expect((await accept(first.data.share.id, first.data.code)).status).toBe(404);
      expect((await accept(first.data.share.id, fresh.code)).status).toBe(200);
      // Not for someone else's invite, and not once accepted.
      const other = (await POST(req(`shares/${first.data.share.id}/code`, "s", { method: "POST" }), params({ id: first.data.share.id }))) as Res;
      expect(other.status).toBe(404);
      const late = (await POST(req(`shares/${first.data.share.id}/code`, "o", { method: "POST" }), params({ id: first.data.share.id }))) as Res;
      expect(late.status).toBe(404);
    });
  });

  // ── accept, decline ──
  describe("accept and decline", () => {
    it("the invitee sees the pending invite (no code, no accounts), a stranger does not", async () => {
      await invite();
      const mine = await listShares("m");
      expect(mine.received).toHaveLength(1);
      expect(mine.received[0]).toMatchObject({ status: "pending", role: "viewer", accountCount: 1, accountIds: [] });
      expect(mine.received[0].owner.name).toBe("Name-o");
      expect(JSON.stringify(mine)).not.toMatch(/inviteTokenHash|code/);
      expect((await listShares("s")).received).toHaveLength(0);
    });

    it("needs the right code, from the invited address, and works once", async () => {
      const { data } = await (await invite()).json();
      expect((await accept(data.share.id, "x".repeat(43))).status).toBe(404);
      expect((await accept(data.share.id, data.code, "s")).status).toBe(404); // someone else with the code
      expect((await accept(data.share.id, data.code, "o")).status).toBe(404); // the owner
      expect((await accept("not-an-id", data.code)).status).toBe(404);
      expect((await accept(data.share.id, "short")).status).toBe(400);
      const ok = await accept(data.share.id, data.code);
      expect(ok.status).toBe(200);
      expect((await ok.json()).data.share).toMatchObject({ status: "active", accountIds: [a1] });
      const { default: Share } = await import("@/models/Share");
      const row = await Share.findById(data.share.id).lean<{ inviteTokenHash?: string; member: unknown }>();
      expect(row!.inviteTokenHash).toBeUndefined();
      expect(String(row!.member)).toBe(ids.m);
      // The same code again, even from the same person, is a miss.
      expect((await accept(data.share.id, data.code)).status).toBe(404);
      // The owner is told.
      const { default: Notification } = await import("@/models/Notification");
      const told = await Notification.find({ user: ids.o }).lean();
      expect(told.some((n) => (n.meta as { kind: string }).kind === "household_accepted")).toBe(true);
    });

    it("guessing is rate limited", async () => {
      const { data } = await (await invite()).json();
      let last = 0;
      for (let i = 0; i < 12; i++) last = (await accept(data.share.id, "g".repeat(43) + i)).status;
      expect(last).toBe(429);
      // Even the right code is refused while locked out.
      expect((await accept(data.share.id, data.code)).status).toBe(429);
    });

    it("decline ends the invite for good", async () => {
      const { data } = await (await invite()).json();
      const { POST } = await import("@/app/api/integrations/shares/[id]/decline/route");
      const other = (await POST(req(`shares/${data.share.id}/decline`, "s", { method: "POST" }), params({ id: data.share.id }))) as Res;
      expect(other.status).toBe(404);
      const res = (await POST(req(`shares/${data.share.id}/decline`, "m", { method: "POST" }), params({ id: data.share.id }))) as Res;
      expect(res.status).toBe(200);
      expect((await accept(data.share.id, data.code)).status).toBe(404);
      expect((await shared("accounts")).status).toBe(404);
      expect((await listShares("m")).received).toHaveLength(0);
    });
  });

  // ── permission matrix on the shared routes ──
  describe("access check on every shared route", () => {
    const routes = ["accounts", "transactions", "summary", "budgets"] as const;

    it("is a 404 for the owner, a stranger, a pending, a declined, a revoked and an expired share", async () => {
      await seedData();
      // never shared
      for (const r of routes) expect((await shared(r, "m")).status).toBe(404);
      for (const r of routes) expect((await shared(r, "o")).status).toBe(404); // not a member of yourself
      // pending
      const pending = await (await invite({ includeBudgets: true })).json();
      for (const r of routes) expect((await shared(r, "m")).status).toBe(404);
      // active: the member sees it, a stranger still does not
      expect((await accept(pending.data.share.id, pending.data.code)).status).toBe(200);
      for (const r of routes) expect((await shared(r, "m")).status).toBe(200);
      for (const r of routes) expect((await shared(r, "s")).status).toBe(404);
      for (const r of routes) expect((await shared(r, "x")).status).toBe(404);
      // not a valid owner id
      expect((await shared("accounts", "m", "", "nope")).status).toBe(404);
      // revoked
      expect((await endShare(pending.data.share.id, "o")).status).toBe(200);
      for (const r of routes) expect((await shared(r, "m")).status).toBe(404);
      // declined and expired
      const d = await (await invite()).json();
      const { POST } = await import("@/app/api/integrations/shares/[id]/decline/route");
      await POST(req(`shares/${d.data.share.id}/decline`, "m", { method: "POST" }), params({ id: d.data.share.id }));
      for (const r of routes) expect((await shared(r, "m")).status).toBe(404);
      const e = await (await invite()).json();
      const { default: Share } = await import("@/models/Share");
      await Share.updateOne({ _id: e.data.share.id }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } });
      for (const r of routes) expect((await shared(r, "m")).status).toBe(404);
    });

    it("a 404 looks the same whether or not the owner exists", async () => {
      const real = await shared("accounts", "m");
      const ghost = await shared("accounts", "m", "", "000000000000000000000000");
      expect(real.status).toBe(404);
      expect(ghost.status).toBe(404);
      expect(real.body).toEqual({ ...ghost.body, requestId: real.body.requestId } as typeof real.body);
    });

    it("stops when the owner's account is deactivated", async () => {
      await seedData();
      await activeShare();
      expect((await shared("accounts")).status).toBe(200);
      const { default: User } = await import("@/models/User");
      await User.updateOne({ _id: ids.o }, { $set: { isActive: false } });
      expect((await shared("accounts")).status).toBe(404);
    });
  });

  // ── what the member sees ──
  describe("shared data", () => {
    it("shows only the shared accounts", async () => {
      await seedData();
      await activeShare();
      const { body } = await shared("accounts");
      expect(body.data.accounts.map((a: { name: string }) => a.name)).toEqual(["Joint"]);
      expect(body.data.accounts[0]).toMatchObject({ id: a1, balance: 100000 });
      expect(body.data.owner).toEqual({ id: ids.o, name: "Name-o" });
      expect(body.data.currency).toBe("INR");
      expect(JSON.stringify(body)).not.toMatch(/Secret savings|999000/);
    });

    it("lists only rows of shared accounts, with a fixed set of fields", async () => {
      await seedData();
      await activeShare();
      const { body, status } = await shared("transactions");
      expect(status).toBe(200);
      const text = JSON.stringify(body);
      expect(text).not.toContain("SECRET-ONLY-ON-A2");
      expect(text).not.toContain("77777");
      expect(text).not.toContain("voided one");
      expect(text).not.toContain("deleted one");
      expect(text).not.toContain(a2);
      expect(text).not.toMatch(/private-tag|receipt-id-1|attachments|tags|source|sms/);
      expect(text).not.toMatch(/OWNER-PRIVATE-NOTE|"note"/);
      const descs = body.data.data.map((t: { description: string }) => t.description).sort();
      expect(descs).toEqual(["from savings", "joint dinner", "pay", "refund", "to savings"]);
      for (const t of body.data.data) {
        expect(Object.keys(t).sort()).toEqual(["account", "addedBy", "amount", "category", "date", "description", "id", "subcategory", "transferTo", "type"]);
      }
    });

    it("never names an account that is not shared, on either side of a transfer", async () => {
      await seedData();
      await activeShare();
      const rows = (await shared("transactions")).body.data.data as { description: string; account: string | null; transferTo: string | null }[];
      const out = rows.find((r) => r.description === "to savings")!;
      expect(out.account).toBe(a1);
      expect(out.transferTo).toBeNull();
      const into = rows.find((r) => r.description === "from savings")!;
      expect(into.account).toBeNull();
      expect(into.transferTo).toBe(a1);
    });

    it("an account that is not shared is a 404, whatever the filter", async () => {
      await seedData();
      await activeShare();
      expect((await shared("transactions", "m", `?accountId=${a2}`)).status).toBe(404);
      expect((await shared("transactions", "m", `?accountId=${a1}`)).status).toBe(200);
      expect((await shared("transactions", "m", `?accountId=nope`)).status).toBe(404);
      expect((await shared("transactions", "m", `?type=bogus`)).status).toBe(400);
      expect((await shared("transactions", "m", `?dateFrom=nonsense`)).status).toBe(400);
    });

    it("caps the page size and the skip", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      await Transaction.insertMany(
        Array.from({ length: 60 }, (_, i) => ({ user: ids.o, account: a1, type: "expense", amount: 100 + i, category: "Food", date: new Date(Date.now() - i * 1000) }))
      );
      await activeShare();
      const big = (await shared("transactions", "m", "?limit=1000")).body.data;
      expect(big.limit).toBe(50);
      expect(big.data).toHaveLength(50);
      expect(big.total).toBe(60);
      const far = (await shared("transactions", "m", "?skip=99999999")).body.data;
      expect(far.skip).toBe(10000);
      expect(far.data).toHaveLength(0);
      const page2 = (await shared("transactions", "m", "?skip=50&limit=50")).body.data;
      expect(page2.data).toHaveLength(10);
    });

    it("the summary counts the shared accounts only, nets refunds and skips voided rows", async () => {
      await seedData();
      await activeShare();
      const { body } = await shared("summary");
      expect(body.data.balance).toBe(100000); // not 1,099,000
      expect(body.data.accountCount).toBe(1);
      // income 10000 (the confirmed refund is not income), expense 2500 - 500 refund
      expect(body.data.month).toMatchObject({ income: 10000, expense: 2000 });
      expect(JSON.stringify(body)).not.toContain("77777");
    });

    it("budgets only when the share includes them", async () => {
      await seedData();
      const id = await activeShare();
      expect((await shared("budgets")).status).toBe(404);
      const { PATCH } = await import("@/app/api/integrations/shares/[id]/route");
      const res = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { includeBudgets: true } }), params({ id }))) as Res;
      expect(res.status).toBe(200);
      const { body, status } = await shared("budgets");
      expect(status).toBe(200);
      expect(body.data.budgets).toHaveLength(1);
      expect(body.data.budgets[0]).toMatchObject({ category: "Food", limitAmount: 50000 });
      expect((await shared("budgets", "m", "?month=13")).status).toBe(400);
    });

    it("hides an account at once when it is archived or taken out of the share", async () => {
      await seedData();
      const second = await (await import("@/models/Account")).default.create({ user: ids.o, name: "Wallet", type: "cash" });
      const id = await activeShare({ accountIds: [a1, second._id.toString()] });
      expect((await shared("accounts")).body.data.accounts).toHaveLength(2);
      await (await import("@/models/Account")).default.updateOne({ _id: second._id }, { $set: { isArchived: true } });
      expect((await shared("accounts")).body.data.accounts).toHaveLength(1);
      const { PATCH } = await import("@/app/api/integrations/shares/[id]/route");
      await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { accountIds: [second._id.toString()] } }), params({ id }));
      // A share cannot be moved onto an archived account.
      const refused = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { accountIds: [second._id.toString()] } }), params({ id }))) as Res;
      expect(refused.status).toBe(400);
      // Moving it to another account takes the first one out of sight at once.
      const moved = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { accountIds: [a2] } }), params({ id }))) as Res;
      expect(moved.status).toBe(200);
      expect((await shared("accounts")).body.data.accounts.map((a: { name: string }) => a.name)).toEqual(["Secret savings"]);
      const text = JSON.stringify((await shared("transactions")).body);
      expect(text).not.toContain("joint dinner");
      expect(text).toContain("SECRET-ONLY-ON-A2");
    });
  });

  // ── editor writes ──
  describe("editor write", () => {
    const body = (over: Record<string, unknown> = {}) => ({
      accountId: a1,
      type: "expense",
      amount: 4200,
      category: "Groceries",
      description: "veg",
      date: new Date().toISOString(),
      ...over,
    });

    it("an editor adds a row to the owner's account, marked as theirs", async () => {
      await activeShare({ role: "editor" });
      const res = await sharedPost(body());
      expect(res.status).toBe(201);
      expect(res.body.data.transaction).toMatchObject({ account: a1, amount: 4200, category: "Groceries", addedBy: { id: ids.m } });

      const { default: Transaction } = await import("@/models/Transaction");
      const row = await Transaction.findById(res.body.data.transaction.id).lean<{ user: unknown; addedBy: unknown; tags: string[]; source: string }>();
      expect(String(row!.user)).toBe(ids.o);
      expect(String(row!.addedBy)).toBe(ids.m);
      expect(row!.source).toBe("manual");
      // Nothing lands in the member's own data.
      expect(await Transaction.countDocuments({ user: ids.m })).toBe(0);

      const { default: Account } = await import("@/models/Account");
      expect((await Account.findById(a1).lean<{ balance: number }>())!.balance).toBe(100000 - 4200);

      // The owner's ledger names the member as the actor; the owner is told.
      const { default: LedgerBlock } = await import("@/models/LedgerBlock");
      const blocks = await LedgerBlock.find({ user: ids.o, scope: "transaction" }).lean();
      expect(JSON.stringify(blocks)).toContain(ids.m);
      const { default: Notification } = await import("@/models/Notification");
      const told = await Notification.find({ user: ids.o }).lean();
      expect(told.some((n) => (n.meta as { kind: string }).kind === "household_write")).toBe(true);

      // It shows up in the shared list with who added it.
      const list = (await shared("transactions")).body.data.data as { description: string; addedBy: { name: string } | null }[];
      expect(list.find((t) => t.description === "veg")!.addedBy).toEqual({ id: ids.m, name: "Name-m" });
    });

    it("a viewer cannot write, a non-member and a pending member get 404", async () => {
      const first = await (await invite({ role: "viewer" })).json();
      expect((await sharedPost(body())).status).toBe(404); // pending
      await accept(first.data.share.id, first.data.code);
      const viewer = await sharedPost(body());
      expect(viewer.status).toBe(403);
      expect(viewer.body.error!.code).toBe("FORBIDDEN");
      expect((await sharedPost(body(), "s")).status).toBe(404);
      const { default: Transaction } = await import("@/models/Transaction");
      expect(await Transaction.countDocuments({})).toBe(0);
    });

    it("only a shared account, and nothing but a plain income or expense", async () => {
      await activeShare({ role: "editor" });
      expect((await sharedPost(body({ accountId: a2 }))).status).toBe(404);
      expect((await sharedPost(body({ accountId: "nope" }))).status).toBe(400);
      for (const extra of [{ tags: ["x"] }, { splits: [] }, { transferToId: a2 }, { isRecurring: true }, { originalAmount: 5, originalCurrency: "USD" }, { type: "transfer" }, { amount: 0 }, { amount: 1.5 }]) {
        expect((await sharedPost(body(extra))).status).toBe(400);
      }
      expect((await sharedPost(body({ date: "garbage" }))).status).toBe(400);
      const { default: Transaction } = await import("@/models/Transaction");
      expect(await Transaction.countDocuments({})).toBe(0);
    });

    it("needs an Idempotency-Key and a retry does not add a second row", async () => {
      await activeShare({ role: "editor" });
      const fixed = body({ date: "2026-03-04T10:00:00.000Z" });
      expect((await sharedPost(fixed, "m", null)).status).toBe(400);
      const one = await sharedPost(fixed, "m", "write-1");
      const two = await sharedPost(fixed, "m", "write-1");
      expect(one.status).toBe(201);
      expect(two.status).toBe(201);
      expect(two.body.data.transaction.id).toBe(one.body.data.transaction.id);
      const { default: Transaction } = await import("@/models/Transaction");
      expect(await Transaction.countDocuments({})).toBe(1);
      const clash = await sharedPost({ ...fixed, amount: 1 }, "m", "write-1");
      expect(clash.status).toBe(409);
    });

    it("a role change applies on the very next request", async () => {
      const id = await activeShare({ role: "editor" });
      expect((await sharedPost(body())).status).toBe(201);
      const { PATCH } = await import("@/app/api/integrations/shares/[id]/route");
      await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { role: "viewer" } }), params({ id }));
      expect((await sharedPost(body())).status).toBe(403);
      await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { role: "editor" } }), params({ id }));
      expect((await sharedPost(body())).status).toBe(201);
    });
  });

  describe("hardening", () => {
    it("a replayed accept after a revoke or a leave is a 404, and the stored answer holds no accounts", async () => {
      const { data } = await (await invite()).json();
      const first = await accept(data.share.id, data.code, "m", "acc-1");
      expect(first.status).toBe(200);
      expect((await first.json()).data.share).toMatchObject({ status: "active", accountIds: [a1] });
      const same = await accept(data.share.id, data.code, "m", "acc-1");
      expect(same.status).toBe(200);
      expect((await same.json()).data.share).toMatchObject({ status: "active" });
      const { default: IdempotencyRecord } = await import("@/models/IdempotencyRecord");
      expect(JSON.stringify(await IdempotencyRecord.find({ endpoint: /accept/ }).lean())).not.toContain(a1);

      expect((await endShare(data.share.id, "o")).status).toBe(200);
      const stale = await accept(data.share.id, data.code, "m", "acc-1");
      expect(stale.status).toBe(404);
      expect(JSON.stringify(await stale.json())).not.toContain(a1);
    });

    it("an editor write re-reads the share: a revoke, a role change or a removed account stops it", async () => {
      const id = await activeShare({ role: "editor" });
      const svc = await import("@/lib/share-service");
      const member = { id: ids.m, name: "Name-m", email: emails.m, role: "user" };
      const input = { accountId: a1, type: "expense" as const, amount: 100, category: "x", date: new Date().toISOString() };
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Share } = await import("@/models/Share");

      // The request loaded its context while the member was an editor ...
      const ctx = (await svc.loadActiveShare(ids.m, ids.o))!;
      // ... and the owner changes the role before the write.
      await svc.updateShare(ids.o, id, { role: "viewer" });
      await expect(svc.addSharedTransaction(ctx, member, input)).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
      await svc.updateShare(ids.o, id, { role: "editor" });
      // Account taken out of the share.
      await Share.updateOne({ _id: id }, { $set: { accountIds: [a2] } });
      await expect(svc.addSharedTransaction(ctx, member, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await Share.updateOne({ _id: id }, { $set: { accountIds: [a1] } });
      // Revoked.
      await svc.revokeShare(ids.o, id);
      await expect(svc.addSharedTransaction(ctx, member, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await Transaction.countDocuments({})).toBe(0);
    });

    it("a row an editor adds does not round up into the owner's goal; the owner's own row does", async () => {
      const { default: Goal } = await import("@/models/Goal");
      const goal = await Goal.create({ user: ids.o, name: "Trip", targetAmount: 10000000, roundUpEnabled: true, roundUpTo: 100 });
      await activeShare({ role: "editor" });
      const res = await sharedPost({ accountId: a1, type: "expense", amount: 4250, category: "Food", date: new Date().toISOString() });
      expect(res.status).toBe(201);
      await new Promise((r) => setTimeout(r, 300));
      expect((await Goal.findById(goal._id).lean<{ savedAmount: number }>())!.savedAmount).toBe(0);

      // Control: the owner's own expense does round up, so the check above can fail.
      const { createTransaction } = await import("@/lib/transaction-service");
      await createTransaction({
        userId: ids.o,
        actor: { id: ids.o, name: "Name-o", email: emails.o, role: "user" },
        accountId: a1,
        type: "expense",
        amount: 4250,
        category: "Food",
        date: new Date().toISOString(),
        tags: [],
        isRecurring: false,
      });
      await new Promise((r) => setTimeout(r, 300));
      expect((await Goal.findById(goal._id).lean<{ savedAmount: number }>())!.savedAmount).toBe(50);
    });
  });

  // ── ending a share ──
  describe("revoke and leave", () => {
    it("a revoke is effective on the next request", async () => {
      await seedData();
      const id = await activeShare({ role: "editor" });
      expect((await shared("transactions")).status).toBe(200);
      expect((await endShare(id, "o")).status).toBe(200);
      expect((await shared("transactions")).status).toBe(404);
      expect((await sharedPost({ accountId: a1, type: "expense", amount: 1, category: "x", date: new Date().toISOString() })).status).toBe(404);
      // The member is told and the share is gone from both lists.
      expect((await listShares("o")).owned).toHaveLength(0);
      expect((await listShares("m")).received).toHaveLength(0);
      // Revoking again, or by a stranger, is a 404.
      expect((await endShare(id, "o")).status).toBe(404);
      expect((await endShare(id, "s")).status).toBe(404);
      // The owner can invite the same person again.
      expect((await invite()).status).toBe(201);
    });

    it("the member can leave, and the owner is told", async () => {
      const id = await activeShare();
      expect((await endShare(id, "x")).status).toBe(404);
      expect((await endShare(id, "m")).status).toBe(200);
      expect((await shared("accounts")).status).toBe(404);
      const { default: Notification } = await import("@/models/Notification");
      const told = await Notification.find({ user: ids.o }).lean();
      expect(told.some((n) => (n.meta as { kind: string }).kind === "household_left")).toBe(true);
    });

    it("only the owner can change a share", async () => {
      const id = await activeShare();
      const { PATCH } = await import("@/app/api/integrations/shares/[id]/route");
      for (const who of ["m", "s"] as Who[]) {
        const res = (await PATCH(req(`shares/${id}`, who, { method: "PATCH", body: { role: "editor" } }), params({ id }))) as Res;
        expect(res.status).toBe(404);
      }
      const bad = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: {} }), params({ id }))) as Res;
      expect(bad.status).toBe(400);
      const foreign = (await PATCH(req(`shares/${id}`, "o", { method: "PATCH", body: { accountIds: ["000000000000000000000000"] } }), params({ id }))) as Res;
      expect(foreign.status).toBe(400);
    });

    it("an ended share leaves the database after 90 days (TTL field set)", async () => {
      const id = await activeShare();
      await endShare(id, "o");
      const { default: Share } = await import("@/models/Share");
      const row = await Share.findById(id).lean<{ status: string; cleanupAt: Date; endedBy: string; inviteTokenHash?: string }>();
      expect(row).toMatchObject({ status: "revoked", endedBy: "owner" });
      expect(row!.inviteTokenHash).toBeUndefined();
      expect(row!.cleanupAt.getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);
    });
  });

  // ── account deletion and backup ──
  describe("account deletion and backup", () => {
    it("deleting an account ends every share it owns or belongs to", async () => {
      const mine = await activeShare({ role: "editor" }); // o -> m
      const { default: Account } = await import("@/models/Account");
      const memberAccount = await Account.create({ user: ids.m, name: "Mine", type: "bank" });
      const reverse = await (
        await invite({ email: emails.o, accountIds: [memberAccount._id.toString()] }, "m")
      ).json();
      expect((await accept(reverse.data.share.id, reverse.data.code, "o")).status).toBe(200);
      const { default: Share } = await import("@/models/Share");

      sessionUser.current = { id: ids.m, name: "Name-m", email: emails.m, role: "user" };
      const { DELETE } = await import("@/app/api/me/route");
      expect((await DELETE()).status).toBe(200);
      const rows = await Share.find({}).lean<{ status: string; endedBy?: string }[]>();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "revoked" && r.endedBy === "account_deleted")).toBe(true);
      expect((await shared("accounts", "o", "", ids.m)).status).toBe(404);
      void mine;
    });

    it("deleting an account also ends pending invites addressed to its email", async () => {
      const { data } = await (await invite()).json(); // o -> m, still pending
      sessionUser.current = { id: ids.m, name: "Name-m", email: emails.m, role: "user" };
      const { DELETE } = await import("@/app/api/me/route");
      expect((await DELETE()).status).toBe(200);
      const { default: Share } = await import("@/models/Share");
      const row = await Share.findById(data.share.id).lean<{ status: string; endedBy: string; inviteTokenHash?: string }>();
      expect(row).toMatchObject({ status: "revoked", endedBy: "account_deleted" });
      expect(row!.inviteTokenHash).toBeUndefined();
      // Someone who registers the freed address cannot use the old code.
      const { default: User } = await import("@/models/User");
      const reborn = await User.create({ name: "New", email: emails.m, password: "h", isActive: true });
      const { default: ApiKey } = await import("@/models/ApiKey");
      const { hashKey } = await import("@/lib/integrations/auth");
      await ApiKey.create({ user: reborn._id, label: "p", keyHash: hashKey("reborn-key"), lastFour: "-key" });
      KEYS.m = "reborn-key";
      expect((await accept(data.share.id, data.code)).status).toBe(404);
      KEYS.m = KEY_M;
    });

    it("a backup never carries shares or the people they name", async () => {
      await seedData();
      await activeShare({ role: "editor" });
      const { buildBackup } = await import("@/lib/backup-service");
      const owner = JSON.stringify((await buildBackup(ids.o)).payload);
      const member = JSON.stringify((await buildBackup(ids.m)).payload);
      for (const text of [owner, member]) {
        expect(text).not.toContain(emails.m);
        expect(text).not.toContain("memberEmail");
        expect(text).not.toContain("inviteTokenHash");
        expect(text).not.toContain("addedBy");
      }
      expect(member).not.toContain("SECRET-ONLY-ON-A2");
      expect(member).not.toContain("Joint");
    });
  });

  // ── existing behaviour ──
  describe("existing routes are unchanged", () => {
    it("a member's own lists never include the owner's data, with or without a share", async () => {
      await seedData();
      await activeShare({ role: "editor" });
      const { GET: listAccounts } = await import("@/app/api/integrations/accounts/route");
      const accounts = (await listAccounts(req("accounts", "m"), {})) as Res;
      expect(JSON.stringify(await accounts.json())).not.toMatch(/Joint|Secret savings/);
      const { GET: listTx } = await import("@/app/api/integrations/transactions/route");
      const txs = (await listTx(req("transactions", "m"), {})) as Res;
      expect(JSON.stringify(await txs.json())).not.toMatch(/joint dinner|lunch|SECRET/);
      // The owner's view of their own data is exactly as before.
      const own = (await listTx(req("transactions", "o"), {})) as Res;
      expect(JSON.stringify(await own.json())).toContain("SECRET-ONLY-ON-A2");
    });
  });

  // ── browser routes ──
  describe("browser routes", () => {
    const as = (who: Who) => {
      sessionUser.current = { id: ids[who], name: `Name-${who}`, email: emails[who], role: "user" };
    };
    const brReq = (path: string, method = "GET", body?: unknown) =>
      new NextRequest(`http://localhost/api/household/${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it("signed out is 401", async () => {
      const { GET } = await import("@/app/api/household/shares/route");
      expect((await GET()).status).toBe(401);
      const { GET: accounts } = await import("@/app/api/household/shared/[ownerId]/accounts/route");
      expect((await accounts(brReq("x"), params({ ownerId: ids.o }))).status).toBe(401);
    });

    it("a body over 8 KB is refused (413) before it is parsed", async () => {
      const big = "x".repeat(20 * 1024);
      const { POST } = await import("@/app/api/household/shares/route");
      const { PATCH } = await import("@/app/api/household/shares/[id]/route");
      const { POST: acceptRoute } = await import("@/app/api/household/shares/[id]/accept/route");
      as("o");
      expect((await POST(brReq("shares", "POST", { email: emails.m, accountIds: [a1], pad: big }))).status).toBe(413);
      expect((await PATCH(brReq("x", "PATCH", { role: "editor", pad: big }), params({ id: a1 }))).status).toBe(413);
      as("m");
      expect((await acceptRoute(brReq("x", "POST", { code: big }), params({ id: a1 }))).status).toBe(413);
      // Not JSON at all.
      const bad = new NextRequest("http://localhost/api/household/shares", { method: "POST", body: "{nope" });
      as("o");
      expect((await POST(bad)).status).toBe(400);
      const { default: Share } = await import("@/models/Share");
      expect(await Share.countDocuments({})).toBe(0);
    });

    it("invite, accept, read and leave", async () => {
      await seedData();
      const { GET, POST } = await import("@/app/api/household/shares/route");
      as("o");
      const made = await POST(brReq("shares", "POST", { email: emails.m, accountIds: [a1], role: "viewer" }));
      expect(made.status).toBe(201);
      const { share, code } = (await made.json()).data;

      as("m");
      const { POST: acceptRoute } = await import("@/app/api/household/shares/[id]/accept/route");
      expect((await acceptRoute(brReq("x", "POST", { code: "w".repeat(43) }), params({ id: share.id }))).status).toBe(404);
      expect((await acceptRoute(brReq("x", "POST", {}), params({ id: share.id }))).status).toBe(400);
      expect((await acceptRoute(brReq("x", "POST", { code }), params({ id: share.id }))).status).toBe(200);
      const list = (await (await GET()).json()).data;
      expect(list.received[0]).toMatchObject({ status: "active", accountIds: [a1] });

      const { GET: accounts } = await import("@/app/api/household/shared/[ownerId]/accounts/route");
      const { GET: txns } = await import("@/app/api/household/shared/[ownerId]/transactions/route");
      const { GET: summary } = await import("@/app/api/household/shared/[ownerId]/summary/route");
      expect((await accounts(brReq("x"), params({ ownerId: ids.o }))).status).toBe(200);
      const t = await txns(new NextRequest(`http://localhost/api/household/shared/${ids.o}/transactions?limit=5`), params({ ownerId: ids.o }));
      expect(t.status).toBe(200);
      expect(JSON.stringify(await t.json())).not.toContain("SECRET-ONLY-ON-A2");
      expect((await summary(brReq("x"), params({ ownerId: ids.o }))).status).toBe(200);
      as("s");
      expect((await accounts(brReq("x"), params({ ownerId: ids.o }))).status).toBe(404);
      expect((await txns(brReq("x"), params({ ownerId: ids.o }))).status).toBe(404);

      as("m");
      const { DELETE } = await import("@/app/api/household/shares/[id]/route");
      expect((await DELETE(brReq("x", "DELETE"), params({ id: share.id }))).status).toBe(200);
      expect((await accounts(brReq("x"), params({ ownerId: ids.o }))).status).toBe(404);
    });
  });
});
