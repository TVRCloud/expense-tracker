import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

vi.mock("@/lib/redis", () => ({ redis: null }));

process.env.CAPTURE_ENCRYPTION_KEY = "test-capture-encryption-key-at-least-32-chars";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { default: connectDB } = await import("@/lib/mongodb");
  await connectDB();
});

afterEach(async () => {
  const { resetAuthCacheForTests } = await import("@/lib/integrations/auth");
  const { resetRateLimitWindowsForTests } = await import("@/lib/integrations/rate-limit");
  resetAuthCacheForTests();
  resetRateLimitWindowsForTests();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const PASS = "correct horse battery staple";
const KEY_A = "test-backup-api-key-user-a";
const KEY_B = "test-backup-api-key-user-b";

describe("encrypted backup and restore", () => {
  let a: string;
  let b: string;
  let n = 0;

  beforeEach(async () => {
    process.env.N8N_RATE_LIMIT = "1000";
    const { default: User } = await import("@/models/User");
    const { default: ApiKey } = await import("@/models/ApiKey");
    const { hashKey } = await import("@/lib/integrations/auth");
    const ua = await User.create({ name: "A", email: `a${Date.now()}${Math.random()}@x.com`, password: "secret-hash-a", isActive: true });
    const ub = await User.create({ name: "B", email: `b${Date.now()}${Math.random()}@x.com`, password: "secret-hash-b", isActive: true });
    await ApiKey.create({ user: ua._id, label: "phone", keyHash: hashKey(KEY_A), lastFour: KEY_A.slice(-4) });
    await ApiKey.create({ user: ub._id, label: "phone", keyHash: hashKey(KEY_B), lastFour: KEY_B.slice(-4) });
    a = ua._id.toString();
    b = ub._id.toString();
  });

  function req(path: string, body: unknown, key = KEY_A, headers: Record<string, string> = {}) {
    n += 1;
    return new NextRequest(`http://localhost/api/integrations/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }
  async function exportBackup(passphrase = PASS, key = KEY_A) {
    const { POST } = await import("@/app/api/integrations/backup/route");
    return POST(req("backup", { passphrase }, key), {});
  }
  async function restore(
    body: Record<string, unknown>,
    opts: { key?: string; idem?: string | null } = {}
  ) {
    const { POST } = await import("@/app/api/integrations/backup/restore/route");
    const idem = opts.idem === undefined ? `restore-${n + 1}` : opts.idem;
    return POST(req("backup/restore", body, opts.key ?? KEY_A, idem ? { "idempotency-key": idem } : {}), {});
  }

  // A small but complete set of data for one user.
  async function seed(userId: string) {
    const M = async (name: string) => (await import(`@/models/${name}`)).default;
    const [Account, Transaction, Budget, Goal, Loan, Repayment, Rule, SinkingFund, ManualAsset, SubscriptionDecision, SpendLimit, Holding] =
      await Promise.all(
        ["Account", "Transaction", "Budget", "Goal", "Loan", "Repayment", "Rule", "SinkingFund", "ManualAsset", "SubscriptionDecision", "SpendLimit", "Holding"].map(M)
      );
    const bank = await Account.create({ user: userId, name: "HDFC", type: "bank", balance: 90000 });
    const card = await Account.create({
      user: userId,
      name: "Card",
      type: "credit_card",
      balance: -5000,
      creditMeta: { creditLimit: 100000, billingCycleDay: 5, paymentDueDay: 20, lastFourDigits: "1234" },
      rewardRule: { kind: "cashback", baseRate: 1.5 },
    });
    const gone = await Account.create({ user: userId, name: "Deleted", type: "cash", deletedAt: new Date() });
    const spend = await Transaction.create({
      user: userId,
      account: bank._id,
      type: "expense",
      amount: 25000,
      category: "Food",
      description: "SECRET-MERCHANT-NAME",
      date: new Date("2026-03-04T10:00:00Z"),
      tags: ["dinner"],
    });
    await Transaction.create({
      user: userId,
      account: bank._id,
      type: "income",
      amount: 5000,
      category: "Refund",
      date: new Date("2026-03-05T10:00:00Z"),
      refundOf: spend._id,
      refundStatus: "confirmed",
    });
    await Transaction.create({
      user: userId,
      account: bank._id,
      transferTo: card._id,
      type: "transfer",
      amount: 7000,
      category: "Transfer",
      date: new Date("2026-03-06T10:00:00Z"),
    });
    await Transaction.create({ user: userId, account: bank._id, type: "expense", amount: 1, category: "Food", date: new Date(), isDeleted: true });
    await Transaction.create({ user: userId, account: gone._id, type: "expense", amount: 1, category: "Food", date: new Date() });
    await Transaction.create({ user: userId, account: bank._id, transferTo: gone._id, type: "transfer", amount: 300, category: "Transfer", date: new Date("2026-03-07T10:00:00Z") });
    await Budget.create({ user: userId, category: "Food", month: 3, year: 2026, limitAmount: 500000 });
    await Goal.create({ user: userId, name: "Bike", targetAmount: 300000, savedAmount: 1000 });
    const loan = await Loan.create({
      user: userId,
      direction: "given",
      counterparty: "Ravi",
      principalAmount: 10000,
      remainingAmount: 8000,
      startDate: new Date("2026-01-01T00:00:00Z"),
      account: bank._id,
    });
    await Repayment.create({ user: userId, loan: loan._id, amount: 2000, date: new Date("2026-02-01T00:00:00Z"), account: bank._id });
    await Rule.create({ user: userId, field: "merchant", value: "Swiggy", valueKey: "swiggy", category: "Food", account: bank._id });
    await SinkingFund.create({ user: userId, name: "Insurance", targetAmount: 120000, dueDate: new Date("2026-12-15T00:00:00Z") });
    await ManualAsset.create({ user: userId, name: "Flat", kind: "property", value: 5000000 });
    await SubscriptionDecision.create({ user: userId, key: "netflix|monthly", merchant: "Netflix", status: "confirmed" });
    await Holding.create({
      user: userId, name: "Nifty fund", kind: "mutual_fund", unitsMicro: 12_500_000, investedAmount: 100000, currentValue: 125000,
      valueUpdatedAt: new Date("2026-03-01T00:00:00Z"), history: [{ value: 100000, at: new Date("2026-01-01T00:00:00Z") }, { value: 125000, at: new Date("2026-03-01T00:00:00Z") }],
      sip: { amount: 5000, dayOfMonth: 31, startDay: "2026-01-31", active: true },
    });
    await Holding.create({
      user: userId, name: "Bank FD", kind: "fixed_deposit", investedAmount: 10000000, currentValue: 10000000,
      fd: { principal: 10000000, rateBps: 725, startDay: "2026-01-01", maturityDay: "2027-01-01" },
    });
    await Holding.create({ user: userId, name: "Sold", kind: "stock", investedAmount: 5, currentValue: 5, isArchived: true });
    await SpendLimit.create({ user: userId, dailyAmount: 50000, weeklyAmount: 200000, limitHistory: [{ from: new Date("2026-03-01T00:00:00Z"), dailyAmount: 50000 }] });
    return { bank: bank._id.toString(), card: card._id.toString() };
  }

  async function wipe(userId: string) {
    const names = ["Account", "Transaction", "Budget", "Goal", "Loan", "Repayment", "Rule", "SinkingFund", "ManualAsset", "SubscriptionDecision", "SpendLimit", "Holding"];
    for (const name of names) await (await import(`@/models/${name}`)).default.deleteMany({ user: userId });
  }

  it("exports an encrypted file with no plain text, no secrets and no soft-deleted rows", async () => {
    await seed(a);
    const res = await exportBackup();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.counts).toMatchObject({
      accounts: 3,
      transactions: 5,
      budgets: 1,
      goals: 1,
      loans: 1,
      repayments: 1,
      rules: 1,
      sinkingFunds: 1,
      manualAssets: 1,
      holdings: 2,
      subscriptionDecisions: 1,
      spendLimit: 1,
    });
    // a deleted account goes in too, so its transactions and the transfer to it stay attached
    expect(data.omitted).toEqual({});
    const text = JSON.stringify(data.backup);
    expect(text).not.toContain("SECRET-MERCHANT-NAME");
    expect(text).not.toContain("secret-hash-a");
    expect(data.backup).toMatchObject({ format: "expense-tracker-backup", v: 2, kdf: { name: "scrypt", N: 131072, r: 8, p: 1 } });
  });

  it("never puts keys, passwords or other users' rows in the plain text", async () => {
    await seed(a);
    await seed(b);
    const { buildBackup } = await import("@/lib/backup-service");
    const { payload } = await buildBackup(a);
    const plain = JSON.stringify(payload);
    expect(plain).not.toContain("secret-hash");
    expect(plain).not.toContain("keyHash");
    expect(plain).not.toContain(b);
    expect(plain).not.toContain(`"user"`);
    expect(payload.data.accounts).toHaveLength(3);
  });

  it("round-trips: wipe, restore, same rows with the same ids, owned by the caller", async () => {
    const ids = await seed(a);
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Repayment } = await import("@/models/Repayment");
    const { default: SpendLimit } = await import("@/models/SpendLimit");
    const before = await Transaction.find({ user: a, isDeleted: { $ne: true }, account: ids.bank }).sort({ date: 1 }).lean();
    const { data } = await (await exportBackup()).json();
    await wipe(a);
    expect(await Account.countDocuments({ user: a })).toBe(0);

    const res = await restore({ passphrase: PASS, backup: data.backup });
    expect(res.status).toBe(200);
    const report = (await res.json()).data;
    expect(report).toMatchObject({ dryRun: false, restored: true });
    expect(report.counts.accounts).toEqual({ inBackup: 3, toCreate: 3, existing: 0 });
    expect(report.counts.transactions).toEqual({ inBackup: 5, toCreate: 5, existing: 0 });
    expect(report.warnings).toEqual([]);

    const accounts = await Account.find({ user: a }).lean();
    expect(accounts).toHaveLength(3);
    expect(accounts.map((x) => String(x._id))).toEqual(expect.arrayContaining([ids.bank, ids.card]));
    expect(accounts.filter((x) => x.deletedAt)).toHaveLength(1);
    const card = accounts.find((x) => String(x._id) === ids.card)!;
    expect(card).toMatchObject({ balance: -5000, creditMeta: { creditLimit: 100000, lastFourDigits: "1234" }, rewardRule: { kind: "cashback", baseRate: 1.5 } });
    const after = await Transaction.find({ user: a, isDeleted: { $ne: true }, account: ids.bank }).sort({ date: 1 }).lean();
    expect(after.map((t) => [String(t._id), t.amount, t.type, t.category, t.description ?? null, String(t.refundOf ?? ""), String(t.transferTo ?? "")])).toEqual(
      before.map((t) => [String(t._id), t.amount, t.type, t.category, t.description ?? null, String(t.refundOf ?? ""), String(t.transferTo ?? "")])
    );
    expect(after.every((t) => !t.isDeleted)).toBe(true);
    expect(await Repayment.countDocuments({ user: a })).toBe(1);
    expect((await SpendLimit.findOne({ user: a }).lean())?.limitHistory).toHaveLength(1);
  });

  it("restores into another user with fresh ids, keeping references valid and the owner's rows untouched", async () => {
    const ids = await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Loan } = await import("@/models/Loan");
    const { default: Repayment } = await import("@/models/Repayment");

    const res = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B });
    expect(res.status).toBe(200);

    const mine = await Account.find({ user: b }).lean();
    expect(mine).toHaveLength(3);
    expect(mine.map((x) => String(x._id))).not.toContain(ids.bank);
    const mineIds = new Set(mine.map((x) => String(x._id)));
    const txs = await Transaction.find({ user: b }).lean();
    expect(txs).toHaveLength(5);
    for (const t of txs) {
      expect(mineIds.has(String(t.account))).toBe(true);
      if (t.transferTo) expect(mineIds.has(String(t.transferTo))).toBe(true);
    }
    const refund = txs.find((t) => t.refundOf)!;
    expect(txs.map((t) => String(t._id))).toContain(String(refund.refundOf));
    const loan = await Loan.findOne({ user: b }).lean();
    expect(mineIds.has(String(loan!.account))).toBe(true);
    const rep = await Repayment.findOne({ user: b }).lean();
    expect(String(rep!.loan)).toBe(String(loan!._id));

    // user A is unchanged
    expect(await Account.countDocuments({ user: a })).toBe(3);
    expect(await Transaction.countDocuments({ user: a })).toBe(6);
    expect(await Account.countDocuments({ _id: { $in: [ids.bank, ids.card] }, user: a })).toBe(2);
  });

  it("a wrong passphrase and a changed file give the same generic answer and write nothing", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Account } = await import("@/models/Account");
    await wipe(a);

    const wrong = await restore({ passphrase: "another passphrase entirely", backup: data.backup });
    expect(wrong.status).toBe(400);
    const wrongBody = await wrong.json();
    expect(wrongBody.error).toMatchObject({ code: "VALIDATION_ERROR", reason: "unreadable" });

    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    const cases = [
      { ...data.backup, ciphertext: flip(data.backup.ciphertext) },
      { ...data.backup, cipher: { ...data.backup.cipher, tag: flip(data.backup.cipher.tag) } },
      { ...data.backup, cipher: { ...data.backup.cipher, iv: flip(data.backup.cipher.iv) } },
      { ...data.backup, kdf: { ...data.backup.kdf, salt: flip(data.backup.kdf.salt) } },
      { ...data.backup, createdAt: "2020-01-01T00:00:00.000Z" },
    ];
    for (const tampered of cases) {
      const res = await restore({ passphrase: PASS, backup: tampered });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error.message).toBe(wrongBody.error.message);
      expect(body.error.reason).toBe("unreadable");
    }
    expect(await Account.countDocuments({ user: a })).toBe(0);
  });

  it("a dry run reports what would happen and writes nothing, and needs no Idempotency-Key", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    await wipe(a);

    const res = await restore({ passphrase: PASS, backup: data.backup, dryRun: true }, { idem: null });
    expect(res.status).toBe(200);
    const report = (await res.json()).data;
    expect(report).toMatchObject({ dryRun: true, restored: false });
    expect(report.counts.accounts).toEqual({ inBackup: 3, toCreate: 3, existing: 0 });
    expect(report.counts.spendLimit).toEqual({ inBackup: 1, toCreate: 1, existing: 0 });
    expect(await Account.countDocuments({ user: a })).toBe(0);
    expect(await Transaction.countDocuments({ user: a })).toBe(0);

    // a real restore without a key is refused
    const noKey = await restore({ passphrase: PASS, backup: data.backup }, { idem: null });
    expect(noKey.status).toBe(400);
    expect(await Account.countDocuments({ user: a })).toBe(0);
  });

  it("merge twice adds nothing the second time; the same key replays the first answer", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Transaction } = await import("@/models/Transaction");
    await wipe(a);

    const first = await restore({ passphrase: PASS, backup: data.backup }, { idem: "same" });
    const firstBody = (await first.json()).data;
    expect(firstBody.counts.transactions.toCreate).toBe(5);
    const replay = await restore({ passphrase: PASS, backup: data.backup }, { idem: "same" });
    expect((await replay.json()).data).toEqual(firstBody);

    const again = await restore({ passphrase: PASS, backup: data.backup }, { idem: "another" });
    const body = (await again.json()).data;
    for (const k of Object.keys(body.counts)) expect(body.counts[k].toCreate).toBe(0);
    expect(await Transaction.countDocuments({ user: a })).toBe(5);
  });

  it("adds missing rows into existing accounts without deleting, and warns that balances are untouched", async () => {
    const ids = await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const extra = await Transaction.create({ user: a, account: ids.bank, type: "expense", amount: 99, category: "Other", date: new Date() });
    await Transaction.deleteOne({ user: a, amount: 25000 });

    const res = await restore({ passphrase: PASS, backup: data.backup });
    const report = (await res.json()).data;
    expect(report.counts.accounts).toEqual({ inBackup: 3, toCreate: 0, existing: 3 });
    expect(report.counts.transactions.toCreate).toBe(1);
    expect(report.warnings[0]).toContain("balances are not changed");
    // the deleted account sits in the trash and is not brought back
    expect(report.warnings.join(" ")).toContain("already exist in your trash");
    expect(await Transaction.exists({ _id: extra._id })).toBeTruthy();
    expect((await Account.findById(ids.bank).lean())!.balance).toBe(90000);
  });

  it("rejects a bad shape, a wrong cost, a short passphrase and a huge body", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();

    expect((await restore({ passphrase: "short", backup: data.backup })).status).toBe(400);
    const costly = { ...data.backup, kdf: { ...data.backup.kdf, N: 1048576 } };
    const r1 = await restore({ passphrase: PASS, backup: costly });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.reason).toBe("invalid");
    expect((await restore({ passphrase: PASS, backup: { hello: "world" } })).status).toBe(400);
    expect((await restore({ passphrase: PASS })).status).toBe(400);

    const { POST } = await import("@/app/api/integrations/backup/restore/route");
    const huge = new NextRequest("http://localhost/api/integrations/backup/restore", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json", "content-length": String(200 * 1024 * 1024), "idempotency-key": "huge" },
      body: "{}",
    });
    const res = await POST(huge, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.reason).toBe("too_large");

    const { POST: EXPORT } = await import("@/app/api/integrations/backup/route");
    expect((await EXPORT(req("backup", { passphrase: "short" }), {})).status).toBe(400);
    expect((await EXPORT(req("backup", "not json"), {})).status).toBe(400);
  });

  describe("an opened file is still untrusted", () => {
    async function craft(data: Record<string, unknown>, over: Record<string, unknown> = {}) {
      const { encryptBackup } = await import("@/lib/backup-crypto");
      return encryptBackup({ app: "expense-tracker", version: 1, createdAt: new Date().toISOString(), data, ...over }, PASS);
    }
    const oid = () => new mongoose.Types.ObjectId().toHexString();
    const acct = (id: string, over: Record<string, unknown> = {}) => ({ id, name: "Mine", type: "bank", balance: 1, ...over });

    it("ignores user ids, roles and unknown fields in the file", async () => {
      const id = oid();
      const backup = await craft({
        accounts: [acct(id, { user: b, role: "admin", deletedBy: b, $set: { x: 1 }, isAdmin: true })],
      });
      const res = await restore({ passphrase: PASS, backup });
      expect(res.status).toBe(200);
      const { default: Account } = await import("@/models/Account");
      const doc = await Account.findById(id).lean<Record<string, unknown>>();
      expect(String(doc!.user)).toBe(a);
      expect(doc).not.toHaveProperty("role");
      expect(doc).not.toHaveProperty("isAdmin");
      expect(doc).not.toHaveProperty("deletedBy");
      expect(await Account.countDocuments({ user: b })).toBe(0);
    });

    it("rejects dangling references, duplicate ids and over-long lists, writing nothing", async () => {
      const { default: Account } = await import("@/models/Account");
      const id = oid();
      const tx = (over: Record<string, unknown>) => ({ id: oid(), account: id, type: "expense", amount: 1, category: "x", date: new Date().toISOString(), ...over });

      const dangling = await craft({ accounts: [acct(id)], transactions: [tx({ account: oid() })] });
      const r1 = await restore({ passphrase: PASS, backup: dangling });
      expect(r1.status).toBe(400);
      expect((await r1.json()).error.reason).toBe("invalid");

      const dup = await craft({ accounts: [acct(id), acct(id)] });
      expect((await restore({ passphrase: PASS, backup: dup })).status).toBe(400);

      const many = await craft({ accounts: Array.from({ length: 1001 }, () => acct(oid())) });
      expect((await restore({ passphrase: PASS, backup: many })).status).toBe(400);

      const badAmount = await craft({ accounts: [acct(id)], transactions: [tx({ amount: 1e20 })] });
      expect((await restore({ passphrase: PASS, backup: badAmount })).status).toBe(400);
      expect(await Account.countDocuments({})).toBe(0);
    });

    it("refuses a newer payload version and a different app", async () => {
      const newer = await craft({}, { version: 4 });
      const r = await restore({ passphrase: PASS, backup: newer });
      expect(r.status).toBe(400);
      expect((await r.json()).error.message).toContain("newer version");
      const other = await craft({}, { app: "something-else" });
      expect((await restore({ passphrase: PASS, backup: other })).status).toBe(400);
    });
  });

  it("running the same restore again into another user is a no-op (ids are derived, not random)", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Repayment } = await import("@/models/Repayment");

    const first = (await (await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "b-1" })).json()).data;
    expect(first.counts.accounts.toCreate).toBe(3);
    const snapshot = async () => [
      (await Account.find({ user: b }).lean()).map((x) => String(x._id)).sort(),
      (await Transaction.find({ user: b }).lean()).map((x) => String(x._id)).sort(),
      (await Repayment.find({ user: b }).lean()).map((x) => String(x._id)).sort(),
    ];
    const one = await snapshot();

    // a retry under a new key (a lost reply, a second tap)
    const again = (await (await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "b-2" })).json()).data;
    for (const k of Object.keys(again.counts)) expect(again.counts[k].toCreate).toBe(0);
    expect(await snapshot()).toEqual(one);
    expect(await Account.countDocuments({ user: b })).toBe(3);
    expect(await Transaction.countDocuments({ user: b })).toBe(5);
  });

  it("a restore that stops half way can simply be run again, with no copies", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Repayment } = await import("@/models/Repayment");

    const spy = vi.spyOn(Transaction, "insertMany").mockRejectedValueOnce(new Error("boom"));
    const failed = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "half-1" });
    spy.mockRestore();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("boom");
    expect(await Account.countDocuments({ user: b })).toBe(3);
    expect(await Transaction.countDocuments({ user: b })).toBe(0);

    const retry = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "half-2" });
    expect(retry.status).toBe(200);
    const report = (await retry.json()).data;
    expect(report.counts.accounts).toEqual({ inBackup: 3, toCreate: 0, existing: 3 });
    expect(report.counts.transactions.toCreate).toBe(5);
    expect(await Account.countDocuments({ user: b })).toBe(3);
    expect(await Transaction.countDocuments({ user: b })).toBe(5);
    expect(await Repayment.countDocuments({ user: b })).toBe(1);
  });

  it("a transfer to a deleted account keeps its destination", async () => {
    const ids = await seed(a);
    const { buildBackup } = await import("@/lib/backup-service");
    const { payload } = await buildBackup(a);
    const gone = payload.data.accounts.find((x) => x.deletedAt)!;
    const leg = payload.data.transactions.find((t) => t.amount === 300)!;
    expect(leg.transferTo).toBe(gone.id);
    expect(leg.account).toBe(ids.bank);
  });

  it("the same key and file with a wrong passphrase is refused, not replayed", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    await wipe(a);
    const ok = await restore({ passphrase: PASS, backup: data.backup }, { idem: "replay" });
    expect(ok.status).toBe(200);
    const bad = await restore({ passphrase: "not the passphrase at all", backup: data.backup }, { idem: "replay" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.reason).toBe("unreadable");
    const good = await restore({ passphrase: PASS, backup: data.backup }, { idem: "replay" });
    expect(good.status).toBe(200);
  });

  it("still restores a version 1 file (the lower cost stays whitelisted)", async () => {
    const { encryptBackup } = await import("@/lib/backup-crypto");
    const id = new mongoose.Types.ObjectId().toHexString();
    const old = await encryptBackup(
      { app: "expense-tracker", version: 1, createdAt: new Date().toISOString(), data: { accounts: [{ id, name: "Old", type: "bank", balance: 5 }] } },
      PASS,
      { version: 1 }
    );
    expect(old).toMatchObject({ v: 1, kdf: { N: 65536 } });
    const res = await restore({ passphrase: PASS, backup: old });
    expect(res.status).toBe(200);
    const { default: Account } = await import("@/models/Account");
    expect(await Account.exists({ _id: id, user: a })).toBeTruthy();
    // a version 1 file cannot claim the version 2 cost, or the reverse
    expect((await restore({ passphrase: PASS, backup: { ...old, kdf: { ...old.kdf, N: 131072 } } })).status).toBe(400);
  });

  describe("series and split groups", () => {
    const oid = () => new mongoose.Types.ObjectId().toHexString();
    async function craft(data: Record<string, unknown>) {
      const { encryptBackup } = await import("@/lib/backup-crypto");
      return encryptBackup({ app: "expense-tracker", version: 1, createdAt: new Date().toISOString(), data }, PASS);
    }

    it("a series or split id that another person already uses is not joined", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Account } = await import("@/models/Account");
      const theirAcct = await Account.create({ user: b, name: "Theirs", type: "bank" });
      const recurringId = new mongoose.Types.ObjectId();
      const splitGroupId = new mongoose.Types.ObjectId();
      const theirs = await Transaction.create({
        user: b, account: theirAcct._id, type: "expense", amount: 5, category: "Rent", date: new Date(),
        isRecurring: true, recurringId, recurrenceIsOpenEnded: true, installmentIndex: 1, installmentStatus: "upcoming", splitGroupId,
      });

      const acct = oid();
      const backup = await craft({
        accounts: [{ id: acct, name: "Mine", type: "bank", balance: 0 }],
        transactions: [
          { id: oid(), account: acct, type: "expense", amount: 9, category: "Rent", date: new Date().toISOString(), recurringId: recurringId.toHexString(), splitGroupId: splitGroupId.toHexString(), isRecurring: true },
          { id: oid(), account: acct, type: "expense", amount: 9, category: "Fresh", date: new Date().toISOString(), recurringId: oid() },
        ],
      });
      const res = await restore({ passphrase: PASS, backup });
      expect(res.status).toBe(200);
      const mine = await Transaction.find({ user: a }).sort({ category: 1 }).lean();
      expect(mine).toHaveLength(2);
      const rent = mine.find((t) => t.category === "Rent")!;
      expect(String(rent.recurringId)).not.toBe(String(recurringId));
      expect(String(rent.splitGroupId)).not.toBe(String(splitGroupId));
      // a group nobody else uses keeps its id
      const fresh = mine.find((t) => t.category === "Fresh")!;
      expect(fresh.recurringId).toBeTruthy();
      // their row is untouched and still alone in its series
      expect(await Transaction.countDocuments({ recurringId })).toBe(1);
      expect(String((await Transaction.findById(theirs._id).lean())!.user)).toBe(b);

      // running it again does not make a second series
      const again = await restore({ passphrase: PASS, backup }, { idem: "grp-2" });
      expect((await again.json()).data.counts.transactions.toCreate).toBe(0);
    });

    it("topping up an open-ended series stays inside one person's rows", async () => {
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Account } = await import("@/models/Account");
      const { topUpRecurringSeries } = await import("@/lib/recurring-topup");
      const { OPEN_ENDED_WINDOW } = await import("@/lib/recurrence");
      const shared = new mongoose.Types.ObjectId();
      const mk = async (user: string, category: string) => {
        const acct = await Account.create({ user, name: category, type: "bank" });
        await Transaction.create({
          user, account: acct._id, type: "expense", amount: 10, category, date: new Date(), isRecurring: true,
          recurringId: shared, recurrenceFrequency: "monthly", recurrenceInterval: 1, recurrenceIsOpenEnded: true,
          installmentIndex: 1, installmentStatus: "upcoming",
        });
        return acct._id.toString();
      };
      const acctA = await mk(a, "A-series");
      const acctB = await mk(b, "B-series");
      await topUpRecurringSeries();
      const rowsA = await Transaction.find({ user: a, recurringId: shared }).lean();
      const rowsB = await Transaction.find({ user: b, recurringId: shared }).lean();
      expect(rowsA).toHaveLength(OPEN_ENDED_WINDOW);
      expect(rowsB).toHaveLength(OPEN_ENDED_WINDOW);
      expect(rowsA.every((t) => String(t.account) === acctA && t.category === "A-series")).toBe(true);
      expect(rowsB.every((t) => String(t.account) === acctB && t.category === "B-series")).toBe(true);
    });
  });

  describe("derived ids cannot be squatted", () => {
    it("a row planted on the id a restore would use does not break it, and a re-run is still a no-op", async () => {
      const ids = await seed(a);
      const { data } = await (await exportBackup()).json();
      const { default: User } = await import("@/models/User");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      const { derivedId } = await import("@/lib/backup-service");
      const squatter = await User.create({ name: "C", email: `c${Date.now()}${Math.random()}@x.com`, password: "h", isActive: true });
      // the squatter works out the first id and then the second one, and sits on both
      for (const attempt of [0, 1]) {
        await Account.create({ _id: derivedId(b, "account", ids.bank, attempt), user: squatter._id, name: "Squat", type: "bank" });
      }

      const first = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "sq-1" });
      expect(first.status).toBe(200);
      const mine = await Account.find({ user: b }).lean();
      expect(mine).toHaveLength(3);
      expect(mine.map((x) => String(x._id))).toContain(derivedId(b, "account", ids.bank, 2));
      const txs = await Transaction.find({ user: b }).lean();
      const mineIds = new Set(mine.map((x) => String(x._id)));
      expect(txs).toHaveLength(5);
      expect(txs.every((t) => mineIds.has(String(t.account)))).toBe(true);
      // the squatter's rows are untouched
      expect(await Account.countDocuments({ user: squatter._id })).toBe(2);

      const again = (await (await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "sq-2" })).json()).data;
      for (const k of Object.keys(again.counts)) expect(again.counts[k].toCreate).toBe(0);
      expect(await Account.countDocuments({ user: b })).toBe(3);
      expect(await Transaction.countDocuments({ user: b })).toBe(5);
    });

    it("the derived id is not the plain hash of public values", async () => {
      const { createHash } = await import("crypto");
      const { derivedId } = await import("@/lib/backup-service");
      const id = new mongoose.Types.ObjectId().toHexString();
      const plain = createHash("sha256").update(`${b}:account:${id}`).digest("hex").slice(0, 24);
      expect(derivedId(b, "account", id)).not.toBe(plain);
      expect(derivedId(b, "account", id)).toBe(derivedId(b, "account", id));
      expect(derivedId(b, "account", id)).not.toBe(derivedId(a, "account", id));
      expect(derivedId(b, "account", id)).not.toBe(derivedId(b, "loan", id));
    });

    it("a series id planted on the derived group id is skipped too", async () => {
      const { default: User } = await import("@/models/User");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      const { derivedId } = await import("@/lib/backup-service");
      const { encryptBackup } = await import("@/lib/backup-crypto");
      const other = await User.create({ name: "D", email: `d${Date.now()}${Math.random()}@x.com`, password: "h", isActive: true });
      const acct = await Account.create({ user: other._id, name: "Theirs", type: "bank" });
      const R = new mongoose.Types.ObjectId().toHexString();
      const row = (recurringId: string) => ({
        user: other._id, account: acct._id, type: "expense", amount: 1, category: "x", date: new Date(), recurringId,
      });
      await Transaction.create(row(R)); // another person uses the file's series id
      await Transaction.create(row(derivedId(b, "group", R, 0))); // and the first replacement is planted

      const accountId = new mongoose.Types.ObjectId().toHexString();
      const backup = await encryptBackup(
        {
          app: "expense-tracker", version: 1, createdAt: new Date().toISOString(),
          data: {
            accounts: [{ id: accountId, name: "Mine", type: "bank", balance: 0 }],
            transactions: [{ id: new mongoose.Types.ObjectId().toHexString(), account: accountId, type: "expense", amount: 1, category: "y", date: new Date().toISOString(), recurringId: R }],
          },
        },
        PASS
      );
      expect((await restore({ passphrase: PASS, backup }, { key: KEY_B, idem: "g-1" })).status).toBe(200);
      const mine = (await Transaction.findOne({ user: b }).lean())!;
      expect(String(mine.recurringId)).toBe(derivedId(b, "group", R, 1));
      expect(await Transaction.countDocuments({ user: { $ne: b }, recurringId: mine.recurringId })).toBe(0);
      const again = (await (await restore({ passphrase: PASS, backup }, { key: KEY_B, idem: "g-2" })).json()).data;
      expect(again.counts.transactions.toCreate).toBe(0);
    });
  });

  it("turns a request away before reading its body when the key gate is full", async () => {
    const { encryptBackup, decryptBackup } = await import("@/lib/backup-crypto");
    const env = await encryptBackup({ ok: true }, PASS);
    // two running and four queued fill the gate; anything past that is refused at once
    const crowd = Array.from({ length: 10 }, () => decryptBackup(env, PASS).catch(() => undefined));
    const { POST } = await import("@/app/api/integrations/backup/restore/route");
    const res = await POST(
      new NextRequest("http://localhost/api/integrations/backup/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json" },
        body: "not json (a busy server must answer before it looks at this)",
      }),
      {}
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error.reason).toBe("busy");
    await Promise.allSettled(crowd);
  });

  it("refuses to build a backup whose answer would be over the response limit, before encrypting", async () => {
    const { randomBytes } = await import("crypto");
    const { default: Account } = await import("@/models/Account");
    const { default: Transaction } = await import("@/models/Transaction");
    const crypto = await import("@/lib/backup-crypto");
    const acct = await Account.create({ user: a, name: "Big", type: "bank" });
    // random text does not compress, so ~2,000 rows of it pass 4 MB once packed and encoded
    const rows = Array.from({ length: 2000 }, () => ({
      user: a, account: acct._id, type: "expense", amount: 1, category: "Bulk", date: new Date(), note: randomBytes(3000).toString("base64"),
    }));
    for (let i = 0; i < rows.length; i += 500) await Transaction.insertMany(rows.slice(i, i + 500));
    const seal = vi.spyOn(crypto, "sealPacked");
    const res = await exportBackup();
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "TOO_LARGE_FOR_RESPONSE", reason: "too_large_for_response" });
    expect(body.error.message).toContain("CSV");
    expect(seal).not.toHaveBeenCalled();
    seal.mockRestore();
  });

  it("never lets the top-up grow rows that have no series id, and restore clears that flag", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    const { default: Account } = await import("@/models/Account");
    const { topUpRecurringSeries } = await import("@/lib/recurring-topup");
    const { encryptBackup } = await import("@/lib/backup-crypto");
    const loose = async (user: string) => {
      const acct = await Account.create({ user, name: "L", type: "bank" });
      await Transaction.create({
        user, account: acct._id, type: "expense", amount: 1, category: "Loose", date: new Date(), isRecurring: true,
        recurrenceFrequency: "monthly", recurrenceIsOpenEnded: true, installmentIndex: 1, installmentStatus: "upcoming",
      });
    };
    await loose(a);
    await loose(b);
    await topUpRecurringSeries();
    expect(await Transaction.countDocuments({ category: "Loose" })).toBe(2);

    const acct = new mongoose.Types.ObjectId().toHexString();
    const backup = await encryptBackup(
      {
        app: "expense-tracker", version: 1, createdAt: new Date().toISOString(),
        data: {
          accounts: [{ id: acct, name: "R", type: "bank", balance: 0 }],
          transactions: [{ id: new mongoose.Types.ObjectId().toHexString(), account: acct, type: "expense", amount: 1, category: "Restored", date: new Date().toISOString(), isRecurring: true, recurrenceIsOpenEnded: true }],
        },
      },
      PASS
    );
    expect((await restore({ passphrase: PASS, backup }, { key: KEY_B })).status).toBe(200);
    const row = (await Transaction.findOne({ user: b, category: "Restored" }).lean())!;
    expect(row.recurrenceIsOpenEnded).not.toBe(true);
  });

  it("has indexes for the series and split id lookups", async () => {
    const { default: Transaction } = await import("@/models/Transaction");
    await Transaction.init();
    const indexes = await Transaction.collection.indexes();
    expect(indexes.find((i) => i.name === "recurringId_1")).toMatchObject({ sparse: true });
    expect(indexes.find((i) => i.name === "splitGroupId_1")).toMatchObject({ sparse: true });
  });

  it("a busy answer does not use up the caller's request slots", async () => {
    const { encryptBackup, decryptBackup } = await import("@/lib/backup-crypto");
    const { default: SecurityRateLimit } = await import("@/models/SecurityRateLimit");
    const env = await encryptBackup({ ok: true }, PASS);
    const crowd = Array.from({ length: 10 }, () => decryptBackup(env, PASS).catch(() => undefined));
    const { POST } = await import("@/app/api/integrations/backup/route");
    for (let i = 0; i < 3; i += 1) expect((await POST(req("backup", { passphrase: PASS }), {})).status).toBe(429);
    expect(await SecurityRateLimit.countDocuments({ key: `backup:request:${a}` })).toBe(0);
    await Promise.allSettled(crowd);
  });

  // The gate is full, but the early "is it open" check is made to say yes, so the
  // call is counted and then meets the full gate: the busy-at-the-gate path.
  async function withFullGate<T>(run: () => Promise<T>): Promise<T> {
    const crypto = await import("@/lib/backup-crypto");
    const env = await crypto.encryptBackup({ ok: true }, PASS);
    const crowd = Array.from({ length: 10 }, () => crypto.decryptBackup(env, PASS).catch(() => undefined));
    const open = vi.spyOn(crypto, "keyGateOpen").mockReturnValue(true);
    try {
      return await run();
    } finally {
      open.mockRestore();
      await Promise.allSettled(crowd);
    }
  }
  const countOf = async (bucket: string, user: string) => {
    const { default: SecurityRateLimit } = await import("@/models/SecurityRateLimit");
    return (await SecurityRateLimit.findOne({ key: `backup:${bucket}:${user}` }).lean())?.count ?? 0;
  };

  it("export: a busy gate answers before any database or compression work, and gives the counts back", async () => {
    await seed(a);
    const service = await import("@/lib/backup-service");
    const build = vi.spyOn(service, "buildBackup");
    const res = await withFullGate(() => exportBackup());
    expect(res.status).toBe(429);
    expect((await res.json()).error.reason).toBe("busy");
    expect(build).not.toHaveBeenCalled();
    build.mockRestore();
    expect(await countOf("request", a)).toBe(0);
    expect(await countOf("export", a)).toBe(0);
  });

  it("restore: a busy gate answers before the file is opened, and gives the counts back", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    const crypto = await import("@/lib/backup-crypto");
    const service = await import("@/lib/backup-service");
    const res = await withFullGate(async () => {
      const open = vi.spyOn(crypto, "decryptBackup");
      const restoreSpy = vi.spyOn(service, "restoreBackup");
      const out = await restore({ passphrase: PASS, backup: data.backup });
      expect(open).not.toHaveBeenCalled();
      expect(restoreSpy).not.toHaveBeenCalled();
      open.mockRestore();
      restoreSpy.mockRestore();
      return out;
    });
    expect(res.status).toBe(429);
    expect(await countOf("restore", a)).toBe(0);
    expect(await countOf("request", a)).toBe(1); // the export above; this one was given back
  });

  it("once work has started a busy error is not refunded (no way to get free expensive work)", async () => {
    await seed(a);
    const { BackupError } = await import("@/lib/backup-crypto");
    const service = await import("@/lib/backup-service");
    const build = vi.spyOn(service, "buildBackup").mockRejectedValue(new BackupError("busy", "busy"));
    const res = await exportBackup();
    build.mockRestore();
    expect(res.status).toBe(429);
    expect(await countOf("request", a)).toBe(1);
    expect(await countOf("export", a)).toBe(1);
  });

  it("holds at most four body reads at once and refuses the rest as busy", async () => {
    const { readBackupBody } = await import("@/lib/integrations/backup-http");
    const stalled = () => {
      let release!: () => void;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          };
        },
      });
      const fake = { headers: new Headers(), body: stream } as unknown as NextRequest;
      return { fake, release };
    };
    const reads = Array.from({ length: 4 }, (_, i) => stalled());
    const pending = reads.map((r, i) => readBackupBody(r.fake, "rid", `user-${i}`));
    const fifth = await readBackupBody(stalled().fake, "rid", "user-5");
    expect(fifth).toMatchObject({ ok: false, busy: true });
    expect((fifth as { res: Response }).res.status).toBe(429);
    reads.forEach((r) => r.release());
    expect((await Promise.all(pending)).every((r) => r.ok)).toBe(true);
    // the slots are free again
    const again = stalled();
    const next = readBackupBody(again.fake, "rid", "user-1");
    again.release();
    expect((await next).ok).toBe(true);
  });

  it("lets one person read one body at a time, so they cannot take every slot", async () => {
    const { readBackupBody } = await import("@/lib/integrations/backup-http");
    let release!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        };
      },
    });
    const first = readBackupBody({ headers: new Headers(), body: stream } as unknown as NextRequest, "rid", "same-user");
    const second = await readBackupBody({ headers: new Headers(), body: new Blob(["{}"]).stream() } as unknown as NextRequest, "rid", "same-user");
    expect(second).toMatchObject({ ok: false, busy: true });
    // someone else is not held up
    const other = await readBackupBody({ headers: new Headers(), body: new Blob(["{}"]).stream() } as unknown as NextRequest, "rid", "other-user");
    expect(other.ok).toBe(true);
    release();
    expect((await first).ok).toBe(true);
    // and the same person can read again once done
    const later = await readBackupBody({ headers: new Headers(), body: new Blob(["{}"]).stream() } as unknown as NextRequest, "rid", "same-user");
    expect(later.ok).toBe(true);
  });

  describe("body read deadlines", () => {
    afterEach(async () => {
      const { BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.totalMs = 90_000;
      BODY_LIMITS.idleMs = 15_000;
    });

    it("gives up on a stream that stops sending, cancels it and frees the slot", async () => {
      const { readBackupBody, BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.idleMs = 60;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        cancel() {
          cancelled = true;
        },
      });
      const out = await readBackupBody({ headers: new Headers(), body: stream } as unknown as NextRequest, "rid", "slow-user");
      expect(out.ok).toBe(false);
      expect(((await (out as { res: Response }).res.json()) as { error: { reason: string } }).error.reason).toBe("timeout");
      expect(cancelled).toBe(true);
      const again = await readBackupBody({ headers: new Headers(), body: new Blob(["{}"]).stream() } as unknown as NextRequest, "rid", "slow-user");
      expect(again.ok).toBe(true);
    });

    it("does not wait for a cancel that never finishes", async () => {
      const { readBackupBody, BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.idleMs = 50;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        cancel: () => new Promise<void>(() => undefined), // hangs for good
      });
      const began = Date.now();
      const out = await readBackupBody({ headers: new Headers(), body: stream } as unknown as NextRequest, "rid", "hung-user");
      expect(out.ok).toBe(false);
      expect(Date.now() - began).toBeLessThan(2000);
      const again = await readBackupBody({ headers: new Headers(), body: new Blob(["{}"]).stream() } as unknown as NextRequest, "rid", "hung-user");
      expect(again.ok).toBe(true);
    });

    it("gives up on a slow trickle that never ends, by the total deadline", async () => {
      const { readBackupBody, BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.totalMs = 150;
      BODY_LIMITS.idleMs = 100;
      let cancelled = false;
      let timer: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => {
            try {
              controller.enqueue(new TextEncoder().encode(" "));
            } catch {
              clearInterval(timer);
            }
          }, 30);
        },
        cancel() {
          cancelled = true;
          clearInterval(timer);
        },
      });
      const out = await readBackupBody({ headers: new Headers(), body: stream } as unknown as NextRequest, "rid", "trickle-user");
      expect(out.ok).toBe(false);
      expect(((await (out as { res: Response }).res.json()) as { error: { reason: string } }).error.reason).toBe("timeout");
      expect(cancelled).toBe(true);
    });
  });

  describe("what a refused request costs", () => {
    afterEach(async () => {
      const { BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.totalMs = 90_000;
      BODY_LIMITS.idleMs = 15_000;
    });

    it("a client's own mistake (too large, a bad passphrase or file) keeps the request count", async () => {
      const { POST } = await import("@/app/api/integrations/backup/restore/route");
      const huge = new NextRequest("http://localhost/api/integrations/backup/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json", "content-length": String(200 * 1024 * 1024) },
        body: "{}",
      });
      expect((await POST(huge, {})).status).toBe(400);
      expect(await countOf("request", a)).toBe(1);
      expect((await restore({ passphrase: "short", backup: {} })).status).toBe(400);
      expect(await countOf("request", a)).toBe(2);
      expect((await restore({ passphrase: PASS, backup: { hello: "world" } })).status).toBe(400);
      expect(await countOf("request", a)).toBe(3);
    });

    it("a timed out upload (a slow link) gets the request count back", async () => {
      const { BODY_LIMITS } = await import("@/lib/integrations/backup-http");
      BODY_LIMITS.idleMs = 60;
      const { POST } = await import("@/app/api/integrations/backup/restore/route");
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
      });
      const slow = new NextRequest("http://localhost/api/integrations/backup/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]);
      const res = await POST(slow, {});
      expect(res.status).toBe(400);
      expect((await res.json()).error.reason).toBe("timeout");
      expect(await countOf("request", a)).toBe(0);
    });
  });

  describe("the key gate's time limits", () => {
    afterEach(async () => {
      const { GATE_LIMITS } = await import("@/lib/backup-crypto");
      GATE_LIMITS.waitMs = 10_000;
      GATE_LIMITS.jobMs = 50_000;
    });
    const hold = () => {
      let release!: () => void;
      const done = new Promise<void>((resolve) => (release = resolve));
      return { release, job: () => done };
    };

    it("a waiter gives up with busy after the wait limit and leaves the queue", async () => {
      const { withKeyGate, keyGateOpen, GATE_LIMITS } = await import("@/lib/backup-crypto");
      GATE_LIMITS.waitMs = 80;
      const one = hold();
      const two = hold();
      const running = [withKeyGate(one.job), withKeyGate(two.job)];
      const waiters = Array.from({ length: 4 }, () => withKeyGate(async () => "ran").then(() => "ran", (e) => (e as { reason: string }).reason));
      expect(keyGateOpen()).toBe(false);
      expect(await Promise.all(waiters)).toEqual(["busy", "busy", "busy", "busy"]);
      expect(keyGateOpen()).toBe(true); // they left the queue
      one.release();
      two.release();
      await Promise.all(running);
      // a job started after all that runs at once
      expect(await withKeyGate(async () => "ok")).toBe("ok");
    });

    it("a job that overruns is cut loose with timeout and its slot is freed", async () => {
      const { withKeyGate, GATE_LIMITS } = await import("@/lib/backup-crypto");
      GATE_LIMITS.jobMs = 80;
      const stuck = () => withKeyGate(() => new Promise<never>(() => undefined)).catch((e) => (e as { reason: string }).reason);
      expect(await Promise.all([stuck(), stuck()])).toEqual(["timeout", "timeout"]);
      GATE_LIMITS.jobMs = 50_000;
      const began = Date.now();
      expect(await Promise.all([withKeyGate(async () => 1), withKeyGate(async () => 2)])).toEqual([1, 2]);
      expect(Date.now() - began).toBeLessThan(1000);
    });
  });

  it("a normal export does call the encryption step once", async () => {
    await seed(a);
    const crypto = await import("@/lib/backup-crypto");
    const seal = vi.spyOn(crypto, "sealPacked");
    expect((await exportBackup()).status).toBe(200);
    expect(seal).toHaveBeenCalledTimes(1);
    seal.mockRestore();
  });

  describe("receipts, foreign amounts, tax and the base currency", () => {
    const oidHex = () => new mongoose.Types.ObjectId().toHexString();
    async function craftFile(over: Record<string, unknown>, data: Record<string, unknown>) {
      const { encryptBackup } = await import("@/lib/backup-crypto");
      return encryptBackup({ app: "expense-tracker", version: 2, createdAt: new Date().toISOString(), data, ...over }, PASS);
    }
    async function newUser(key: string, currency?: string) {
      const { default: User } = await import("@/models/User");
      const { default: ApiKey } = await import("@/models/ApiKey");
      const { hashKey } = await import("@/lib/integrations/auth");
      const u = await User.create({
        name: "X", email: `x${Date.now()}${Math.random()}@x.com`, password: "h", isActive: true,
        ...(currency ? { currency, preferences: { currency } } : {}),
      });
      await ApiKey.create({ user: u._id, label: "phone", keyHash: hashKey(key), lastFour: key.slice(-4) });
      return u._id.toString();
    }

    it("a transaction with a receipt is exported (not dropped), without the receipt, and says so", async () => {
      const ids = await seed(a);
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Account } = await import("@/models/Account");
      await Transaction.create({
        user: a, account: ids.bank, type: "expense", amount: 4200, category: "Dining", date: new Date("2026-03-09T10:00:00Z"),
        attachments: [oidHex(), oidHex()],
      });
      const { data } = await (await exportBackup()).json();
      expect(data.counts.transactions).toBe(6);
      expect(data.omitted).toEqual({});
      expect(data.warnings.join(" ")).toContain("2 receipts are not included");
      await wipe(a);
      expect((await restore({ passphrase: PASS, backup: data.backup })).status).toBe(200);
      const row = (await Transaction.findOne({ user: a, category: "Dining" }).lean())!;
      expect(row.amount).toBe(4200);
      expect(row.attachments ?? []).toEqual([]);
      expect(await Account.countDocuments({ user: a })).toBe(3);
    });

    it("keeps foreign-currency originals and the tax flag, and the deductible categories", async () => {
      const ids = await seed(a);
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: User } = await import("@/models/User");
      const when = new Date("2026-03-10T00:00:00Z");
      await Transaction.create({
        user: a, account: ids.bank, type: "expense", amount: 83500, category: "Travel", date: new Date("2026-03-10T10:00:00Z"),
        originalAmount: 1000, originalCurrency: "USD", originalExponent: 2, rate: 83.5, rateDate: when, rateSource: "provider", deductible: true,
      });
      await Transaction.create({ user: a, account: ids.bank, type: "expense", amount: 100, category: "Health", date: new Date(), deductible: false });
      await User.updateOne({ _id: a }, { $set: { "preferences.tax.deductibleCategories": ["health", "travel"] } });

      const { data } = await (await exportBackup()).json();
      await wipe(a);
      await User.updateOne({ _id: a }, { $unset: { "preferences.tax": "" } });
      const res = await restore({ passphrase: PASS, backup: data.backup });
      expect(res.status).toBe(200);
      expect((await res.json()).data.warnings.join(" ")).toContain("deductible tax categories were restored");

      const travel = (await Transaction.findOne({ user: a, category: "Travel" }).lean())!;
      expect(travel).toMatchObject({ originalAmount: 1000, originalCurrency: "USD", originalExponent: 2, rate: 83.5, rateSource: "provider", deductible: true });
      expect(travel.rateDate!.toISOString()).toBe(when.toISOString());
      expect((await Transaction.findOne({ user: a, category: "Health" }).lean())!.deductible).toBe(false);
      expect((await User.findById(a).lean<{ preferences?: { tax?: { deductibleCategories?: string[] } } }>())!.preferences?.tax?.deductibleCategories).toEqual(["health", "travel"]);

      // a person who already has categories keeps them, and is told
      await User.updateOne({ _id: b }, { $set: { "preferences.tax.deductibleCategories": ["rent"] } });
      const other = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B });
      expect((await other.json()).data.warnings.join(" ")).toContain("not changed");
      expect((await User.findById(b).lean<{ preferences?: { tax?: { deductibleCategories?: string[] } } }>())!.preferences?.tax?.deductibleCategories).toEqual(["rent"]);
    });

    it("drops the server's own link tags on restore and keeps the person's tags", async () => {
      const ids = await seed(a);
      const { default: Transaction } = await import("@/models/Transaction");
      await Transaction.create({
        user: a, account: ids.bank, type: "expense", amount: 1, category: "Tagged", date: new Date(),
        tags: ["dinner", "loan:abc", "repayment:def", "credit_statement:ghi", "loan_principal"],
      });
      const { data } = await (await exportBackup()).json();
      await wipe(a);
      await restore({ passphrase: PASS, backup: data.backup });
      expect((await Transaction.findOne({ user: a, category: "Tagged" }).lean())!.tags).toEqual(["dinner"]);
    });

    it("keeps envelope plans: restored with the amounts, no move history, an existing month is left alone, a re-run adds nothing", async () => {
      await seed(a);
      const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
      await EnvelopePlan.create({
        user: a, month: "2026-03", income: 100000, envelopes: [{ category: "Food", assigned: 40000 }, { category: "Rent", assigned: 50000 }],
        moves: [{ from: "Food", to: "Rent", amount: 100, at: new Date() }], createdAt: new Date(), updatedAt: new Date(),
      });
      await EnvelopePlan.create({ user: a, month: "2026-04", income: 5, envelopes: [], moves: [] });
      const { data } = await (await exportBackup()).json();
      expect(data.counts.envelopePlans).toBe(2);

      // into the same person after a wipe: same ids, amounts kept, move history not kept
      await EnvelopePlan.deleteMany({ user: a });
      const restored = await restore({ passphrase: PASS, backup: data.backup });
      expect((await restored.json()).data.counts.envelopePlans).toEqual({ inBackup: 2, toCreate: 2, existing: 0 });
      const march = (await EnvelopePlan.findOne({ user: a, month: "2026-03" }).lean<{ income: number; envelopes: { category: string; assigned: number }[]; moves: unknown[] }>())!;
      expect(march.income).toBe(100000);
      expect(march.envelopes.map((e) => [e.category, e.assigned])).toEqual([["Food", 40000], ["Rent", 50000]]);
      expect(march.moves).toEqual([]);

      // into another person: owned by them, ids derived, a month they already planned is kept as it is
      await EnvelopePlan.create({ user: b, month: "2026-04", income: 7, envelopes: [], moves: [] });
      const other = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B });
      expect((await other.json()).data.counts.envelopePlans).toEqual({ inBackup: 2, toCreate: 1, existing: 1 });
      const theirs = await EnvelopePlan.find({ user: b }).sort({ month: 1 }).lean<{ month: string; income: number }[]>();
      expect(theirs.map((p) => [p.month, p.income])).toEqual([["2026-03", 100000], ["2026-04", 7]]);
      const again = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B });
      expect((await again.json()).data.counts.envelopePlans.toCreate).toBe(0);
      expect(await EnvelopePlan.countDocuments({ user: b })).toBe(2);
      expect(await EnvelopePlan.countDocuments({ user: a })).toBe(2);
    });

    it("exports the base currency and refuses a file in another currency once money data exists", async () => {
      const usd = await newUser("usd-key-for-backup-test-1", "USD");
      const { default: Account } = await import("@/models/Account");
      const { default: User } = await import("@/models/User");
      await Account.create({ user: usd, name: "US bank", type: "bank", balance: 5000 });
      const { data } = await (await exportBackup(PASS, "usd-key-for-backup-test-1")).json();
      const { decryptBackup } = await import("@/lib/backup-crypto");
      expect(((await decryptBackup(data.backup, PASS)) as { baseCurrency: string }).baseCurrency).toBe("USD");

      // user B has INR amounts: refused, dry run included, nothing written
      await Account.create({ user: b, name: "INR bank", type: "bank", balance: 100 });
      for (const dryRun of [true, false]) {
        const res = await restore({ passphrase: PASS, backup: data.backup, dryRun }, { key: KEY_B, idem: dryRun ? null : "base-1" });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({ code: "BASE_CURRENCY_MISMATCH" });
      }
      expect(await Account.countDocuments({ user: b })).toBe(1);
      expect((await User.findById(b).lean<{ preferences?: { currency?: string } }>())!.preferences?.currency).toBe("INR");

      // a locked base with no rows is refused too
      const locked = await newUser("locked-key-for-backup-test-2");
      await User.updateOne({ _id: locked }, { $set: { baseLocked: true } });
      expect((await restore({ passphrase: PASS, backup: data.backup }, { key: "locked-key-for-backup-test-2" })).status).toBe(400);
    });

    it("sets the base from the file when there is no money data yet, and locks it", async () => {
      const usd = await newUser("usd-key-for-backup-test-3", "USD");
      const { default: Account } = await import("@/models/Account");
      const { default: User } = await import("@/models/User");
      await Account.create({ user: usd, name: "US bank", type: "bank", balance: 5000 });
      const { data } = await (await exportBackup(PASS, "usd-key-for-backup-test-3")).json();

      const fresh = await newUser("fresh-key-for-backup-test-4");
      const dry = await restore({ passphrase: PASS, backup: data.backup, dryRun: true }, { key: "fresh-key-for-backup-test-4", idem: null });
      const dryBody = (await dry.json()).data;
      expect(dryBody.baseCurrency).toEqual({ inBackup: "USD", current: "INR", willSet: true });
      expect(dryBody.warnings.join(" ")).toContain("will be set to USD");
      expect((await User.findById(fresh).lean<{ preferences?: { currency?: string } }>())!.preferences?.currency).toBe("INR");

      const res = await restore({ passphrase: PASS, backup: data.backup }, { key: "fresh-key-for-backup-test-4" });
      expect(res.status).toBe(200);
      const user = (await User.findById(fresh).lean<{ preferences?: { currency?: string }; baseLocked?: boolean }>())!;
      expect(user.preferences?.currency).toBe("USD");
      expect(user.baseLocked).toBe(true);
      expect(await Account.countDocuments({ user: fresh })).toBe(1);
    });

    it("an older file (no base recorded) is never taken as INR for another base, and never sets the base", async () => {
      const { default: User } = await import("@/models/User");
      const { default: Account } = await import("@/models/Account");
      const old = await craftFile({ version: 1 }, { accounts: [{ id: oidHex(), name: "Old", type: "bank", balance: 5 }] });

      // a USD person with money data, and a USD person with none: both refused, base untouched
      const withData = await newUser("usd-key-for-backup-test-5", "USD");
      await Account.create({ user: withData, name: "US bank", type: "bank", balance: 5000 });
      const empty = await newUser("usd-key-for-backup-test-6", "USD");
      for (const [key, who] of [["usd-key-for-backup-test-5", withData], ["usd-key-for-backup-test-6", empty]] as const) {
        for (const dryRun of [true, false]) {
          const res = await restore({ passphrase: PASS, backup: old, dryRun }, { key, idem: dryRun ? null : `old-${who}` });
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe("BASE_CURRENCY_UNKNOWN");
        }
      }
      const user = (await User.findById(empty).lean<{ preferences?: { currency?: string }; baseLocked?: boolean }>())!;
      expect(user.preferences?.currency).toBe("USD");
      expect(user.baseLocked).not.toBe(true);
      expect(await Account.countDocuments({ user: empty })).toBe(0);

      // an INR person restores it, with a warning, and the base is not set from the file
      const res = await restore({ passphrase: PASS, backup: old });
      expect(res.status).toBe(200);
      const body = (await res.json()).data;
      expect(body.warnings.join(" ")).toContain("did not record its currency");
      expect(body.baseCurrency).toEqual({ inBackup: null, current: "INR", willSet: false });
    });

    it("a version 2 file without a base currency is invalid", async () => {
      const file = await craftFile({}, { accounts: [{ id: oidHex(), name: "X", type: "bank", balance: 1 }] });
      const res = await restore({ passphrase: PASS, backup: file });
      expect(res.status).toBe(400);
      expect((await res.json()).error.reason).toBe("invalid");
    });

    it("checks the money fields: currencies, exponent, an all-or-none foreign group, and the row currency", async () => {
      const acct = oidHex();
      const tx = (over: Record<string, unknown>) => ({
        id: oidHex(), account: acct, type: "expense", amount: 8350, category: "x", date: new Date().toISOString(), ...over,
      });
      const foreign = { originalAmount: 1000, originalCurrency: "USD", originalExponent: 2, rate: 83.5 };
      // straight through the schema and the restore checks (no key derivation, so it is quick)
      const status = async (t: Record<string, unknown>) => {
        const { parsePayload, restoreBackup } = await import("@/lib/backup-service");
        try {
          const payload = parsePayload({
            app: "expense-tracker", version: 2, createdAt: new Date().toISOString(), baseCurrency: "INR",
            data: { accounts: [{ id: acct, name: "A", type: "bank", balance: 0 }], transactions: [t] },
          });
          await restoreBackup(a, payload, { dryRun: true });
          return 200;
        } catch {
          return 400;
        }
      };

      expect(await status(tx({ ...foreign }))).toBe(200); // the good case
      expect(await status(tx({ ...foreign, originalCurrency: "XXX" }))).toBe(400); // unknown code
      expect(await status(tx({ ...foreign, originalExponent: 3 }))).toBe(400); // USD has 2 digits
      expect(await status(tx({ ...foreign, originalCurrency: "JPY" }))).toBe(400); // JPY has 0
      expect(await status(tx({ ...foreign, originalAmount: 0 }))).toBe(400);
      expect(await status(tx({ originalAmount: 1000, rate: 83.5, originalExponent: 2 }))).toBe(400); // no currency
      expect(await status(tx({ originalCurrency: "USD" }))).toBe(400); // currency alone
      expect(await status(tx({ ...foreign, rate: undefined }))).toBe(400); // no rate
      expect(await status(tx({ rateSource: "provider" }))).toBe(400); // a rate source with no foreign amount
      expect(await status(tx({ currency: "ZZZ" }))).toBe(400); // unknown row currency
      expect(await status(tx({ currency: "USD" }))).toBe(400); // not the file's base
      expect(await status(tx({ currency: "INR" }))).toBe(200);
      expect(await status(tx({ ...foreign, rateDate: new Date().toISOString(), rateSource: "provider" }))).toBe(200);
      expect(await status(tx({ ...foreign, rateSource: "client" }))).toBe(200); // a client rate has no date
    });

    it("labels restored rows with the file's base, not the model default", async () => {
      const usd = await newUser("usd-key-for-backup-test-7", "USD");
      const { default: Account } = await import("@/models/Account");
      const { default: Transaction } = await import("@/models/Transaction");
      const { default: Budget } = await import("@/models/Budget");
      const acct = await Account.create({ user: usd, name: "US", type: "bank", balance: 10 });
      await Transaction.create({ user: usd, account: acct._id, type: "expense", amount: 5, category: "x", date: new Date(), currency: "INR" }); // a writer left the default
      await Budget.create({ user: usd, category: "x", month: 3, year: 2026, limitAmount: 100 });
      const { data } = await (await exportBackup(PASS, "usd-key-for-backup-test-7")).json();
      const fresh = await newUser("usd-key-for-backup-test-8");
      expect((await restore({ passphrase: PASS, backup: data.backup }, { key: "usd-key-for-backup-test-8" })).status).toBe(200);
      expect((await Transaction.findOne({ user: fresh }).lean())!.currency).toBe("USD");
      expect((await Budget.findOne({ user: fresh }).lean())!.currency).toBe("USD");
      expect((await Account.findOne({ user: fresh }).lean())!.currency).toBe("INR"); // an account's own label is kept
    });

    it("a file with only settings sets and locks nothing", async () => {
      const { default: User } = await import("@/models/User");
      const fresh = await newUser("fresh-key-for-backup-test-9");
      const file = await craftFile({ baseCurrency: "USD", tax: { deductibleCategories: ["health"] } }, {});
      const res = await restore({ passphrase: PASS, backup: file }, { key: "fresh-key-for-backup-test-9" });
      expect(res.status).toBe(200);
      const body = (await res.json()).data;
      expect(body.baseCurrency.willSet).toBe(false);
      const user = (await User.findById(fresh).lean<{ preferences?: { currency?: string; tax?: { deductibleCategories?: string[] } }; baseLocked?: boolean }>())!;
      expect(user.preferences?.currency).toBe("INR");
      expect(user.baseLocked).not.toBe(true);
      expect(user.preferences?.tax?.deductibleCategories).toEqual(["health"]);
    });

    it("a dry run leaves the deductible categories unwritten, and a re-run with the same list says nothing", async () => {
      const { default: User } = await import("@/models/User");
      const file = await craftFile({ baseCurrency: "INR", tax: { deductibleCategories: ["Health", "travel"] } }, {});
      const dry = await restore({ passphrase: PASS, backup: file, dryRun: true }, { idem: null });
      expect((await dry.json()).data.warnings.join(" ")).toContain("will be restored");
      const unset = (await User.findById(a).lean<{ preferences?: { tax?: { deductibleCategories?: string[] } } }>())!;
      expect(unset.preferences?.tax?.deductibleCategories ?? []).toEqual([]);

      const real = await restore({ passphrase: PASS, backup: file });
      expect((await real.json()).data.warnings.join(" ")).toContain("were restored");
      const again = await restore({ passphrase: PASS, backup: file }, { idem: "tax-again" });
      expect((await again.json()).data.warnings.join(" ")).not.toContain("deductible");
      // an explicit null (not just a missing field) counts as unset
      await User.updateOne({ _id: b }, { $set: { "preferences.tax.deductibleCategories": null } });
      const nulled = await restore({ passphrase: PASS, backup: file }, { key: KEY_B });
      expect((await nulled.json()).data.warnings.join(" ")).toContain("were restored");
    });

    it("counts only the receipts on rows that are in the file", async () => {
      const ids = await seed(a);
      const { default: Transaction } = await import("@/models/Transaction");
      await Transaction.create({ user: a, account: ids.bank, type: "expense", amount: 5, category: "Kept", date: new Date(), attachments: [oidHex()] });
      // a row the export cannot read (an amount out of range) is left out, and so are its receipts
      await Transaction.create({ user: a, account: ids.bank, type: "expense", amount: 1e20, category: "Bad", date: new Date(), attachments: [oidHex(), oidHex(), oidHex()] });
      const { data } = await (await exportBackup()).json();
      expect(data.omitted).toEqual({ transactions: 1 });
      expect(data.warnings.join(" ")).toContain("1 receipt is not included");
    });

    describe("holdings (investments)", () => {
      it("are exported (not the archived ones) and round-trip with their SIP, deposit terms and history", async () => {
        await seed(a);
        const { default: Holding } = await import("@/models/Holding");
        const before = await Holding.find({ user: a, isArchived: { $ne: true } }).sort({ name: 1 }).lean<Record<string, unknown>[]>();
        const { data } = await (await exportBackup()).json();
        expect(data.counts.holdings).toBe(2);
        expect(data.omitted).toEqual({});
        await wipe(a);
        const res = await restore({ passphrase: PASS, backup: data.backup });
        expect(res.status).toBe(200);
        expect((await res.json()).data.counts.holdings).toEqual({ inBackup: 2, toCreate: 2, existing: 0 });
        const after = await Holding.find({ user: a }).sort({ name: 1 }).lean<Record<string, unknown>[]>();
        expect(after).toHaveLength(2); // the archived one was not in the file
        const pick = (h: Record<string, unknown>) => [String(h._id), h.name, h.kind, h.unitsMicro, h.investedAmount, h.currentValue, h.sip, h.fd, h.history];
        expect(after.map(pick)).toEqual(before.map(pick));
      });

      it("a holding the person removed (archived) is skipped, not brought back, and the report says so", async () => {
        await seed(a);
        const { default: Holding } = await import("@/models/Holding");
        const { data } = await (await exportBackup()).json();
        await Holding.updateOne({ user: a, name: "Bank FD" }, { $set: { isArchived: true } });
        const res = await restore({ passphrase: PASS, backup: data.backup });
        expect(res.status).toBe(200);
        const report = (await res.json()).data;
        expect(report.counts.holdings).toEqual({ inBackup: 2, toCreate: 0, existing: 2 });
        // the other one is the seed's deleted account
        expect(report.warnings.join(" ")).toContain("2 rows in the backup already exist in your trash");
        expect(await Holding.countDocuments({ user: a, isArchived: { $ne: true } })).toBe(1);
      });

      it("restore into another person: fresh ids, theirs alone, and a re-run adds nothing", async () => {
        await seed(a);
        const { default: Holding } = await import("@/models/Holding");
        const { data } = await (await exportBackup()).json();
        expect((await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B })).status).toBe(200);
        const mine = await Holding.find({ user: b }).lean();
        expect(mine).toHaveLength(2);
        const theirs = await Holding.find({ user: a, isArchived: { $ne: true } }).lean();
        expect(mine.map((h) => String(h._id))).not.toEqual(expect.arrayContaining(theirs.map((h) => String(h._id))));
        const again = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B });
        expect((await again.json()).data.counts.holdings).toEqual({ inBackup: 2, toCreate: 0, existing: 2 });
        expect(await Holding.countDocuments({ user: b })).toBe(2);
        expect(await Holding.countDocuments({ user: a })).toBe(3); // the owner's rows are untouched
      });

      it("a file from before holdings existed still restores, with no holdings", async () => {
        const file = await craftFile({ version: 2, baseCurrency: "INR" }, { accounts: [{ id: oidHex(), name: "A", type: "bank", balance: 1 }] });
        const res = await restore({ passphrase: PASS, backup: file });
        expect(res.status).toBe(200);
        expect((await res.json()).data.counts.holdings).toEqual({ inBackup: 0, toCreate: 0, existing: 0 });
      });

      it("checks a holding's own rules: kind, terms, dates and amounts", async () => {
        const hold = (over: Record<string, unknown>) => ({
          id: oidHex(), name: "H", kind: "stock", investedAmount: 100, currentValue: 120, ...over,
        });
        const fd = { principal: 1000, rateBps: 700, startDay: "2026-01-01", maturityDay: "2027-01-01" };
        const status = async (h: Record<string, unknown>) => {
          const { parsePayload, restoreBackup } = await import("@/lib/backup-service");
          try {
            const payload = parsePayload({
              app: "expense-tracker", version: 3, createdAt: new Date().toISOString(), baseCurrency: "INR", data: { holdings: [h] },
            });
            await restoreBackup(a, payload, { dryRun: true });
            return 200;
          } catch {
            return 400;
          }
        };
        expect(await status(hold({}))).toBe(200);
        expect(await status(hold({ kind: "fixed_deposit", fd }))).toBe(200);
        expect(await status(hold({ sip: { amount: 5, dayOfMonth: 31, startDay: "2026-01-31" }, unitsMicro: 1_000_000 }))).toBe(200);
        expect(await status(hold({ kind: "crypto" }))).toBe(400);
        expect(await status(hold({ kind: "fixed_deposit" }))).toBe(400); // no terms
        expect(await status(hold({ fd }))).toBe(400); // terms on a stock
        expect(await status(hold({ kind: "fixed_deposit", fd, sip: { amount: 5, dayOfMonth: 5, startDay: "2026-01-05" } }))).toBe(400);
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, maturityDay: "2026-01-01" } }))).toBe(400);
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, maturityDay: "2026-02-30" } }))).toBe(400);
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, maturityDay: "2075-12-20" } }))).toBe(200); // exactly 50 * 365 days
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, maturityDay: "2075-12-21" } }))).toBe(400); // a day past
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, principal: 1e12, rateBps: 10_000, maturityDay: "2075-12-20" } }))).toBe(400); // worth more than an amount at maturity
        expect(await status(hold({ isArchived: true }))).toBe(400);
        expect(await status(hold({ isArchived: false }))).toBe(200);
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, startDay: "tomorrow" } }))).toBe(400);
        expect(await status(hold({ kind: "fixed_deposit", fd: { ...fd, rateBps: 10_001 } }))).toBe(400);
        expect(await status(hold({ investedAmount: 1e13 + 1 }))).toBe(400);
        expect(await status(hold({ currentValue: -1 }))).toBe(400);
        expect(await status(hold({ unitsMicro: 1e15 + 1 }))).toBe(400);
        expect(await status(hold({ sip: { amount: 5, dayOfMonth: 0, startDay: "2026-01-05" } }))).toBe(400);
        expect(await status(hold({ history: Array.from({ length: 101 }, () => ({ value: 1, at: new Date().toISOString() })) }))).toBe(400);
        expect(await status(hold({ name: "" }))).toBe(400);
      });

      it("a restore that would take a person past 500 holdings is refused, and writes nothing", async () => {
        const { default: Holding } = await import("@/models/Holding");
        await Holding.insertMany(Array.from({ length: 499 }, (_, i) => ({ user: a, name: `H${i}`, kind: "other", investedAmount: 1, currentValue: 1 })));
        const mk = () => ({ id: oidHex(), name: "New", kind: "other", investedAmount: 1, currentValue: 1 });
        const file = await craftFile({ version: 3, baseCurrency: "INR" }, { holdings: [mk(), mk()] });
        const dry = await restore({ passphrase: PASS, backup: file });
        expect(dry.status).toBe(400);
        expect(await Holding.countDocuments({ user: a })).toBe(499);
        const one = await craftFile({ version: 3, baseCurrency: "INR" }, { holdings: [mk()] });
        expect((await restore({ passphrase: PASS, backup: one })).status).toBe(200);
        expect(await Holding.countDocuments({ user: a })).toBe(500);
      });
    });

    describe("a base that is not two decimal", () => {
      const account = () => ({ accounts: [{ id: oidHex(), name: "Yen", type: "bank", balance: 5 }] });

      it("a legacy JPY base cannot take a restore that writes rows, dry run included", async () => {
        const { default: Account } = await import("@/models/Account");
        const jpy = await newUser("jpy-key-for-backup-test-1", "JPY");
        const file = await craftFile({ baseCurrency: "JPY" }, account());
        for (const dryRun of [true, false]) {
          const res = await restore({ passphrase: PASS, backup: file, dryRun }, { key: "jpy-key-for-backup-test-1", idem: dryRun ? null : "jpy-1" });
          expect(res.status).toBe(400);
          const { error } = await res.json();
          expect(error.code).toBe("BASE_CURRENCY_ONLY_TWO_DECIMALS");
          expect(error.message).toContain("two decimals");
        }
        expect(await Account.countDocuments({ user: jpy })).toBe(0);
      });

      it("a file with only envelope plans is refused into a legacy base, dry run included, and writes nothing", async () => {
        const { default: EnvelopePlan } = await import("@/models/EnvelopePlan");
        const jpy = await newUser("jpy-key-for-backup-test-3", "JPY");
        const file = await craftFile({ baseCurrency: "JPY" }, { envelopePlans: [{ id: oidHex(), month: "2026-03", income: 5, envelopes: [{ category: "Food", assigned: 5 }] }] });
        for (const dryRun of [true, false]) {
          const res = await restore({ passphrase: PASS, backup: file, dryRun }, { key: "jpy-key-for-backup-test-3", idem: dryRun ? null : "jpy-env-1" });
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe("BASE_CURRENCY_ONLY_TWO_DECIMALS");
        }
        expect(await EnvelopePlan.countDocuments({ user: jpy })).toBe(0);
      });

      it("a restore that writes nothing is still allowed into a legacy base", async () => {
        await newUser("jpy-key-for-backup-test-2", "JPY");
        const file = await craftFile({ baseCurrency: "JPY", tax: { deductibleCategories: ["health"] } }, {});
        const res = await restore({ passphrase: PASS, backup: file }, { key: "jpy-key-for-backup-test-2" });
        expect(res.status).toBe(200);
      });

      it("a file in such a currency is refused for an empty INR account, the same in a dry run and a real run", async () => {
        const { default: Account } = await import("@/models/Account");
        const { default: User } = await import("@/models/User");
        const fresh = await newUser("fresh-key-for-backup-test-10");
        const file = await craftFile({ baseCurrency: "JPY" }, account());
        for (const dryRun of [true, false]) {
          const res = await restore({ passphrase: PASS, backup: file, dryRun }, { key: "fresh-key-for-backup-test-10", idem: dryRun ? null : "jpy-2" });
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe("BASE_CURRENCY_ONLY_TWO_DECIMALS");
        }
        expect(await Account.countDocuments({ user: fresh })).toBe(0);
        const user = (await User.findById(fresh).lean<{ preferences?: { currency?: string }; baseLocked?: boolean }>())!;
        expect(user.preferences?.currency).toBe("INR");
        expect(user.baseLocked).not.toBe(true);
      });

      it("when setting the base fails, the answer carries the real reason, not the 'amounts stored' text", async () => {
        const base = await import("@/lib/base-currency");
        const usd = await craftFile({ baseCurrency: "USD" }, account());
        await newUser("fresh-key-for-backup-test-11");

        const unsupported = vi
          .spyOn(base, "setBaseCurrency")
          .mockRejectedValueOnce(new base.BaseCurrencyError("UNSUPPORTED_BASE_CURRENCY", "custom two decimal message"));
        const res = await restore({ passphrase: PASS, backup: usd }, { key: "fresh-key-for-backup-test-11", idem: "set-1" });
        unsupported.mockRestore();
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({ code: "BASE_CURRENCY_ONLY_TWO_DECIMALS", message: "custom two decimal message" });

        const stored = vi.spyOn(base, "setBaseCurrency").mockRejectedValueOnce(new base.BaseCurrencyError("HAS_MONEY_DATA", "x"));
        const res2 = await restore({ passphrase: PASS, backup: usd }, { key: "fresh-key-for-backup-test-11", idem: "set-2" });
        stored.mockRestore();
        expect((await res2.json()).error).toMatchObject({ code: "BASE_CURRENCY_MISMATCH" });
      });
    });

    it("an older file with link-style attachments still restores, without them", async () => {
      const acct = oidHex();
      const file = await craftFile(
        { version: 1 },
        {
          accounts: [{ id: acct, name: "A", type: "bank", balance: 0 }],
          transactions: [{ id: oidHex(), account: acct, type: "expense", amount: 1, category: "x", date: new Date().toISOString(), attachments: ["javascript:alert(1)"] }],
        }
      );
      expect((await restore({ passphrase: PASS, backup: file })).status).toBe(200);
      const { default: Transaction } = await import("@/models/Transaction");
      expect((await Transaction.findOne({ user: a }).lean())!.attachments ?? []).toEqual([]);
    });

    it("budgets, rules and subscription choices are not copied by a re-run or a racing run", async () => {
      await seed(a);
      const { data } = await (await exportBackup()).json();
      const { default: Budget } = await import("@/models/Budget");
      const { default: Rule } = await import("@/models/Rule");
      const { default: SubscriptionDecision } = await import("@/models/SubscriptionDecision");
      const { default: Account } = await import("@/models/Account");
      const counts = async () => [
        await Budget.countDocuments({ user: b }),
        await Rule.countDocuments({ user: b }),
        await SubscriptionDecision.countDocuments({ user: b }),
        await Account.countDocuments({ user: b }),
      ];
      // two runs at the same time under different keys: either may fail, and a clean run after them leaves exactly one of each
      await Promise.all([
        restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "race-1" }),
        restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "race-2" }),
      ]);
      // then a clean run finishes the job and a further run adds nothing
      expect((await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "race-3" })).status).toBe(200);
      expect(await counts()).toEqual([1, 1, 1, 3]);
      const again = (await (await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "race-4" })).json()).data;
      for (const k of ["budgets", "rules", "subscriptionDecisions"]) expect(again.counts[k].toCreate).toBe(0);
      expect(await counts()).toEqual([1, 1, 1, 3]);
    });

    it("a budget in the trash is not brought back or copied by a re-run, and the report says so", async () => {
      await seed(a);
      const { data } = await (await exportBackup()).json();
      const { default: Budget } = await import("@/models/Budget");
      expect((await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "tr-1" })).status).toBe(200);
      await Budget.updateOne({ user: b }, { $set: { isDeleted: true, deletedAt: new Date() } });
      const again = await restore({ passphrase: PASS, backup: data.backup }, { key: KEY_B, idem: "tr-2" });
      const body = (await again.json()).data;
      expect(body.counts.budgets).toEqual({ inBackup: 1, toCreate: 0, existing: 1 });
      expect(body.warnings.join(" ")).toContain("already exist in your trash");
      expect(await Budget.countDocuments({ user: b })).toBe(1);
      expect(await Budget.countDocuments({ user: b, isDeleted: { $ne: true } })).toBe(0);
    });

    it("the restore route has a duration limit above the gate's job limit", async () => {
      const route = await import("@/app/api/integrations/backup/restore/route");
      const { GATE_LIMITS } = await import("@/lib/backup-crypto");
      expect(route.maxDuration).toBe(60);
      expect(GATE_LIMITS.jobMs / 1000).toBeLessThan(route.maxDuration);
    });
  });

  it("a dry run does not use up the real restore quota", async () => {
    await seed(a);
    const { data } = await (await exportBackup()).json();
    await wipe(a);
    for (let i = 0; i < 13; i += 1) {
      expect((await restore({ passphrase: PASS, backup: data.backup, dryRun: true }, { idem: null })).status).toBe(200);
    }
    expect((await restore({ passphrase: PASS, backup: data.backup }, { idem: "after-dry-runs" })).status).toBe(200);
  });

  it("reads the body as a stream and stops past the cap, even with no Content-Length", async () => {
    const { POST } = await import("@/app/api/integrations/backup/restore/route");
    const { MAX_BACKUP_BYTES } = await import("@/lib/backup-crypto");
    const big = "x".repeat(Math.ceil((MAX_BACKUP_BYTES * 4) / 3) + 8192);
    const res = await POST(
      new NextRequest("http://localhost/api/integrations/backup/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json", "idempotency-key": "big" },
        body: big,
      }),
      {}
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.reason).toBe("too_large");
  });

  it("checks the quota before reading the body", async () => {
    const { checkSecurityRateLimit } = await import("@/lib/security-rate-limit");
    for (let i = 0; i < 40; i += 1) await checkSecurityRateLimit({ key: `backup:request:${a}`, limit: 40, windowMs: 600000 });
    const { POST } = await import("@/app/api/integrations/backup/restore/route");
    const res = await POST(
      new NextRequest("http://localhost/api/integrations/backup/restore", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY_A}`, "content-type": "application/json" },
        body: "this is not even json",
      }),
      {}
    );
    expect(res.status).toBe(429);
  });

  it("limits how often a user can try", async () => {
    let last = 0;
    for (let i = 0; i < 7; i += 1) last = (await exportBackup()).status;
    expect(last).toBe(429);
    // another user is not affected
    expect((await exportBackup(PASS, KEY_B)).status).toBe(200);
  });

  it("requires an API key", async () => {
    const { POST } = await import("@/app/api/integrations/backup/route");
    const res = await POST(
      new NextRequest("http://localhost/api/integrations/backup", { method: "POST", body: JSON.stringify({ passphrase: PASS }) }),
      {}
    );
    expect(res.status).toBe(401);
  });
});

describe("backup crypto", () => {
  it("round-trips and gives a different file every time", async () => {
    const { encryptBackup, decryptBackup } = await import("@/lib/backup-crypto");
    const one = await encryptBackup({ hello: "world" }, PASS);
    const two = await encryptBackup({ hello: "world" }, PASS);
    expect(one.ciphertext).not.toBe(two.ciphertext);
    expect(one.kdf.salt).not.toBe(two.kdf.salt);
    expect(await decryptBackup(one, PASS)).toEqual({ hello: "world" });
  });

  it("stops a compression bomb that opens with the right passphrase", async () => {
    const { sealPacked, decryptBackup, MAX_PLAIN_BYTES } = await import("@/lib/backup-crypto");
    const { gzipSync } = await import("zlib");
    // 49 MiB of zeros is a few dozen KiB packed: it passes the tag check and must stop at the unpack limit.
    const bomb = gzipSync(Buffer.alloc(MAX_PLAIN_BYTES + 1024 * 1024));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const env = await sealPacked(bomb, PASS);
    await expect(decryptBackup(env, PASS)).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("refuses to build a file whose plain text is over the limit", async () => {
    const { encryptBackup, MAX_PLAIN_BYTES } = await import("@/lib/backup-crypto");
    await expect(encryptBackup({ pad: "a".repeat(MAX_PLAIN_BYTES + 1024) }, PASS)).rejects.toMatchObject({ reason: "too_large" });
  });

  it("turns away work past the queue instead of piling up memory, then recovers", async () => {
    const { encryptBackup, decryptBackup } = await import("@/lib/backup-crypto");
    const env = await encryptBackup({ ok: true }, PASS);
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => decryptBackup(env, PASS)));
    const busy = results.filter((r) => r.status === "rejected" && (r.reason as { reason?: string }).reason === "busy");
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(busy.length).toBeGreaterThan(0);
    expect(await decryptBackup(env, PASS)).toEqual({ ok: true });
  });
});

describe("security rate limit", () => {
  it("lets exactly `limit` of many concurrent callers through", async () => {
    const { checkSecurityRateLimit } = await import("@/lib/security-rate-limit");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => checkSecurityRateLimit({ key: "race", limit: 5, windowMs: 60000 }))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const denied = results.find((r) => !r.allowed) as { retryAfterSeconds: number };
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("answers a short wait, not the whole window, when it keeps losing races", async () => {
    const { checkSecurityRateLimit } = await import("@/lib/security-rate-limit");
    const { default: SecurityRateLimit } = await import("@/models/SecurityRateLimit");
    const dup = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const update = vi.spyOn(SecurityRateLimit, "findOneAndUpdate").mockResolvedValue(null as never);
    const find = vi.spyOn(SecurityRateLimit, "findOne").mockResolvedValue(null as never);
    const create = vi.spyOn(SecurityRateLimit, "create").mockRejectedValue(dup as never);
    const out = (await checkSecurityRateLimit({ key: "hot", limit: 3, windowMs: 3600_000 })) as { allowed: boolean; retryAfterSeconds: number };
    update.mockRestore();
    find.mockRestore();
    create.mockRestore();
    expect(out.allowed).toBe(false);
    expect(out.retryAfterSeconds).toBeLessThanOrEqual(5);
  });

  it("starts a new window once the old one has expired", async () => {
    const { checkSecurityRateLimit } = await import("@/lib/security-rate-limit");
    const { default: SecurityRateLimit } = await import("@/models/SecurityRateLimit");
    await checkSecurityRateLimit({ key: "win", limit: 1, windowMs: 60000 });
    expect((await checkSecurityRateLimit({ key: "win", limit: 1, windowMs: 60000 })).allowed).toBe(false);
    await SecurityRateLimit.updateOne({ key: "win" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await checkSecurityRateLimit({ key: "win", limit: 1, windowMs: 60000 })).allowed).toBe(true);
  });
});
