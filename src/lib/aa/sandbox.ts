import { randomBytes } from "crypto";
import {
  AaProviderError,
  type AaConsentState,
  type AaConsentStatus,
  type AaCreatedConsent,
  type AaFetchPage,
  type AaFinancialAccount,
  type AaProvider,
  type AaTransaction,
} from "@/lib/aa/provider";

// A deterministic stand-in for an Account Aggregator, used in tests and when
// AA_PROVIDER=sandbox. It keeps its state in process memory, so it is never a
// source of real data and loses everything on restart. It never talks to a
// network. The default feed is two bank accounts with a few rupee transactions
// placed relative to the day the consent was made, so a demo always has data.

type SandboxConsent = {
  status: AaConsentStatus;
  createdAt: number;
  expiresAt: number;
  accounts: AaFinancialAccount[];
  transactions: Map<string, AaTransaction[]>;
  revoked: boolean;
};

const consents = new Map<string, SandboxConsent>();
let autoApprove = true;
let failNext = 0;
let failOnly: "createConsent" | "consentStatus" | "fetchTransactions" | null = null;

function shouldFail(call: "createConsent" | "consentStatus" | "fetchTransactions") {
  if (failNext <= 0 || (failOnly && failOnly !== call)) return false;
  failNext -= 1;
  return true;
}

const DAY = 24 * 60 * 60 * 1000;

function defaultFeed(created: number, accounts: AaFinancialAccount[], seed: string) {
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(created - daysAgo * DAY);
    d.setUTCHours(hour, 15, 0, 0);
    return d;
  };
  const [bank, other] = accounts;
  const txn = (n: number, accountRef: string, type: "income" | "expense", paise: number, when: Date, narration: string, reference?: string): AaTransaction => ({
    id: `sbx-${seed}-${n}`,
    accountRef,
    type,
    amountMinor: paise,
    currency: "INR",
    at: when,
    narration,
    ...(reference ? { reference } : {}),
  });
  const feed = new Map<string, AaTransaction[]>();
  feed.set(bank.ref, [
    txn(1, bank.ref, "income", 5_000_000, at(9, 5), "SALARY CREDIT ACME LTD", "100000000001"),
    txn(2, bank.ref, "expense", 45_000, at(6, 13), "UPI/SWIGGY/FOOD ORDER", "100000000002"),
    txn(3, bank.ref, "expense", 120_000, at(3, 8), "UPI/BIGBASKET/GROCERIES", "100000000003"),
  ]);
  feed.set(other.ref, [txn(4, other.ref, "expense", 29_900, at(2, 10), "POS/NETFLIX", "200000000004")]);
  return feed;
}

export const sandboxProvider: AaProvider = {
  name: "sandbox",

  async createConsent({ userRef, durationDays }): Promise<AaCreatedConsent> {
    if (shouldFail("createConsent")) throw new AaProviderError("PROVIDER_ERROR");
    const seed = randomBytes(6).toString("hex");
    const handle = `sbx_${seed}${randomBytes(12).toString("hex")}`;
    const created = Date.now();
    const accounts: AaFinancialAccount[] = [
      { ref: `acct-${seed}-1`, bankName: "HDFC Bank", last4: "1234", instrument: "account" },
      { ref: `acct-${seed}-2`, bankName: "Axis Bank", last4: "9876", instrument: "account" },
    ];
    consents.set(handle, {
      status: "pending",
      createdAt: created,
      expiresAt: created + Math.max(1, durationDays) * DAY,
      accounts,
      transactions: defaultFeed(created, accounts, seed),
      revoked: false,
    });
    void userRef;
    return { handle, redirectUrl: `sandbox://consent/${seed}`, expiresAt: new Date(created + Math.max(1, durationDays) * DAY) };
  },

  async consentStatus(handle): Promise<AaConsentState> {
    const c = consents.get(handle);
    if (!c) throw new AaProviderError("CONSENT_NOT_FOUND");
    if (shouldFail("consentStatus")) throw new AaProviderError("PROVIDER_ERROR");
    if (c.status === "pending" && autoApprove) c.status = "active";
    if (c.status === "active" && Date.now() >= c.expiresAt) c.status = "expired";
    return { status: c.status, accounts: c.status === "pending" ? [] : c.accounts, expiresAt: new Date(c.expiresAt) };
  },

  async fetchTransactions(handle, { accountRef, from, cursor, limit }): Promise<AaFetchPage> {
    const c = consents.get(handle);
    if (!c) throw new AaProviderError("CONSENT_NOT_FOUND");
    if (shouldFail("fetchTransactions")) throw new AaProviderError("PROVIDER_ERROR");
    if (c.status !== "active") throw new AaProviderError("CONSENT_NOT_FOUND");
    const all = (c.transactions.get(accountRef) ?? [])
      .filter((t) => t.at.getTime() >= from.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const page = all.slice(start, start + limit);
    const next = start + page.length;
    return { transactions: page, ...(next < all.length ? { nextCursor: String(next) } : {}) };
  },

  async revoke(handle): Promise<void> {
    const c = consents.get(handle);
    if (!c) return;
    c.status = "revoked";
    c.revoked = true;
  },
};

/** Test and demo control over the sandbox. Not used by the app. */
export const sandboxControl = {
  reset() {
    consents.clear();
    autoApprove = true;
    failNext = 0;
    failOnly = null;
  },
  /** When false a consent stays pending until `approve` is called. */
  setAutoApprove(value: boolean) {
    autoApprove = value;
  },
  approve(handle: string) {
    const c = consents.get(handle);
    if (c && c.status === "pending") c.status = "active";
  },
  setStatus(handle: string, status: AaConsentStatus) {
    const c = consents.get(handle);
    if (c) c.status = status;
  },
  /** The next `n` provider calls fail (only calls of one kind when `only` is given). */
  failNext(n: number, only: typeof failOnly = null) {
    failNext = n;
    failOnly = only;
  },
  accountsOf(handle: string): AaFinancialAccount[] {
    return consents.get(handle)?.accounts ?? [];
  },
  setTransactions(handle: string, accountRef: string, list: AaTransaction[]) {
    consents.get(handle)?.transactions.set(accountRef, list);
  },
  addTransactions(handle: string, accountRef: string, list: AaTransaction[]) {
    const c = consents.get(handle);
    if (c) c.transactions.set(accountRef, [...(c.transactions.get(accountRef) ?? []), ...list]);
  },
  expire(handle: string) {
    const c = consents.get(handle);
    if (c) c.expiresAt = Date.now() - 1;
  },
  isRevoked(handle: string) {
    return consents.get(handle)?.revoked ?? false;
  },
};
