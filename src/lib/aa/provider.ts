// The seam between our code and an Account Aggregator (AA) provider. Nothing
// outside src/lib/aa/ knows how a provider talks; a real one is a file that
// implements AaProvider plus one line in providers.ts. Today the only
// implementation is the deterministic sandbox, so the feature cannot reach a
// bank: going live needs a licensed FIU/TSP agreement, provider credentials and
// legal review (docs/security.md, "Account Aggregator").

export type AaConsentStatus = "pending" | "active" | "paused" | "revoked" | "expired" | "failed";

export type AaFinancialAccount = {
  /** The provider's reference for the account. Opaque. */
  ref: string;
  bankName: string;
  /** Last four digits of the account number. */
  last4: string;
  /** "account" (savings, current) or "card". */
  instrument: "account" | "card";
};

export type AaTransaction = {
  /** The provider's id for the transaction: unique per provider, stable across fetches. */
  id: string;
  accountRef: string;
  type: "income" | "expense";
  /** Always positive, in the minor units of `currency` (paise for INR). */
  amountMinor: number;
  currency: string;
  at: Date;
  /** The bank's narration for the entry. */
  narration: string;
  /** The bank's reference (UTR, cheque number) when it gives one. */
  reference?: string;
};

export type AaCreatedConsent = {
  /** The provider's opaque handle for the consent. A secret: stored encrypted, never shown. */
  handle: string;
  /** Where the user approves the consent (the provider's consent screen). */
  redirectUrl: string;
  expiresAt: Date;
};

export type AaConsentState = {
  status: AaConsentStatus;
  accounts: AaFinancialAccount[];
  expiresAt?: Date;
};

export type AaFetchPage = {
  transactions: AaTransaction[];
  /** Pass back to continue; absent when the feed is read up to now. */
  nextCursor?: string;
};

export interface AaProvider {
  readonly name: string;
  /** Starts a consent for one user. `userRef` is an opaque, stable id for the person (never the email). */
  createConsent(input: { userRef: string; durationDays: number }): Promise<AaCreatedConsent>;
  consentStatus(handle: string): Promise<AaConsentState>;
  /** Transactions of one linked account from `from` (or after `cursor`), at most `limit` per page. */
  fetchTransactions(
    handle: string,
    input: { accountRef: string; from: Date; cursor?: string; limit: number }
  ): Promise<AaFetchPage>;
  /** Withdraws the consent at the provider. Must be safe to call twice. */
  revoke(handle: string): Promise<void>;
}

/** A provider failure the caller may show as a short code. Never carries a provider message or token. */
export class AaProviderError extends Error {
  code: "PROVIDER_ERROR" | "CONSENT_NOT_FOUND";
  constructor(code: AaProviderError["code"], message = code) {
    super(message);
    this.code = code;
    this.name = "AaProviderError";
  }
}
