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
    const [Account, Transaction, Budget, Goal, Loan, Repayment, Rule, SinkingFund, ManualAsset, SubscriptionDecision, SpendLimit] =
      await Promise.all(
        ["Account", "Transaction", "Budget", "Goal", "Loan", "Repayment", "Rule", "SinkingFund", "ManualAsset", "SubscriptionDecision", "SpendLimit"].map(M)
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
    await SpendLimit.create({ user: userId, dailyAmount: 50000, weeklyAmount: 200000, limitHistory: [{ from: new Date("2026-03-01T00:00:00Z"), dailyAmount: 50000 }] });
    return { bank: bank._id.toString(), card: card._id.toString() };
  }

  async function wipe(userId: string) {
    const names = ["Account", "Transaction", "Budget", "Goal", "Loan", "Repayment", "Rule", "SinkingFund", "ManualAsset", "SubscriptionDecision", "SpendLimit"];
    for (const name of names) await (await import(`@/models/${name}`)).default.deleteMany({ user: userId });
  }

  it("exports an encrypted file with no plain text, no secrets and no deleted rows", async () => {
    await seed(a);
    const res = await exportBackup();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.counts).toMatchObject({
      accounts: 2,
      transactions: 3,
      budgets: 1,
      goals: 1,
      loans: 1,
      repayments: 1,
      rules: 1,
      sinkingFunds: 1,
      manualAssets: 1,
      subscriptionDecisions: 1,
      spendLimit: 1,
    });
    // the transaction on the deleted account is left out and reported
    expect(data.omitted).toEqual({ transactions: 1 });
    const text = JSON.stringify(data.backup);
    expect(text).not.toContain("SECRET-MERCHANT-NAME");
    expect(text).not.toContain("secret-hash-a");
    expect(data.backup).toMatchObject({ format: "expense-tracker-backup", v: 1, kdf: { name: "scrypt", N: 65536, r: 8, p: 1 } });
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
    expect(payload.data.accounts).toHaveLength(2);
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
    expect(report.counts.accounts).toEqual({ inBackup: 2, toCreate: 2, existing: 0 });
    expect(report.counts.transactions).toEqual({ inBackup: 3, toCreate: 3, existing: 0 });
    expect(report.warnings).toEqual([]);

    const accounts = await Account.find({ user: a }).lean();
    expect(accounts.map((x) => String(x._id)).sort()).toEqual([ids.bank, ids.card].sort());
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
    expect(mine).toHaveLength(2);
    expect(mine.map((x) => String(x._id))).not.toContain(ids.bank);
    const mineIds = new Set(mine.map((x) => String(x._id)));
    const txs = await Transaction.find({ user: b }).lean();
    expect(txs).toHaveLength(3);
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
    expect(await Transaction.countDocuments({ user: a })).toBe(5);
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
    expect(report.counts.accounts).toEqual({ inBackup: 2, toCreate: 2, existing: 0 });
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
    expect(firstBody.counts.transactions.toCreate).toBe(3);
    const replay = await restore({ passphrase: PASS, backup: data.backup }, { idem: "same" });
    expect((await replay.json()).data).toEqual(firstBody);

    const again = await restore({ passphrase: PASS, backup: data.backup }, { idem: "another" });
    const body = (await again.json()).data;
    for (const k of Object.keys(body.counts)) expect(body.counts[k].toCreate).toBe(0);
    expect(await Transaction.countDocuments({ user: a })).toBe(3);
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
    expect(report.counts.accounts).toEqual({ inBackup: 2, toCreate: 0, existing: 2 });
    expect(report.counts.transactions.toCreate).toBe(1);
    expect(report.warnings[0]).toContain("balances are not changed");
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
      const badUrl = await craft({ accounts: [acct(id)], transactions: [tx({ attachments: ["javascript:alert(1)"] })] });
      expect((await restore({ passphrase: PASS, backup: badUrl })).status).toBe(400);

      expect(await Account.countDocuments({})).toBe(0);
    });

    it("refuses a newer payload version and a different app", async () => {
      const newer = await craft({}, { version: 2 });
      const r = await restore({ passphrase: PASS, backup: newer });
      expect(r.status).toBe(400);
      expect((await r.json()).error.message).toContain("newer version");
      const other = await craft({}, { app: "something-else" });
      expect((await restore({ passphrase: PASS, backup: other })).status).toBe(400);
    });
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
    const { encryptBackup, decryptBackup, MAX_PLAIN_BYTES } = await import("@/lib/backup-crypto");
    // 60 MB of one character compresses to a few tiny bytes and is over the plain limit.
    const bomb = { pad: "a".repeat(MAX_PLAIN_BYTES + 1024) };
    await expect(encryptBackup(bomb, PASS)).rejects.toMatchObject({ reason: "too_large" });
  });
});
