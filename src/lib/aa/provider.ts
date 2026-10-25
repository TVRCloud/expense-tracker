import { z } from "zod";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";

// The seam between our code and an Account Aggregator (AA) provider. Nothing
// outside src/lib/aa/ knows how a provider talks; a real one is a file that
// implements AaProvider plus one line in providers.ts. Today the only
// implementation is the deterministic sandbox, so the feature cannot reach a
// bank: going live needs a licensed FIU/TSP agreement, provider credentials and
// legal review (docs/account-aggregator.md, "Going live").

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
  createConsent(input: { userRef: string; durationDays: number; signal?: AbortSignal }): Promise<AaCreatedConsent>;
  consentStatus(handle: string, opts?: { signal?: AbortSignal }): Promise<AaConsentState>;
  /** Transactions of one linked account from `from` (or after `cursor`), at most `limit` per page. */
  fetchTransactions(
    handle: string,
    input: { accountRef: string; from: Date; cursor?: string; limit: number; signal?: AbortSignal }
  ): Promise<AaFetchPage>;
  /** Withdraws the consent at the provider. Must be safe to call twice. */
  revoke(handle: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

/** A provider failure the caller may show as a short code. Never carries a provider message or token. */
export class AaProviderError extends Error {
  code: "PROVIDER_ERROR" | "CONSENT_NOT_FOUND";
  constructor(code: AaProviderError["code"], message: string = code) {
    super(message);
    this.code = code;
    this.name = "AaProviderError";
  }
}

// What a provider hands back is checked here, at the boundary, before any of our code trusts it. A real provider
// is a network peer: its answers are untrusted input.
const statusSchema = z.enum(["pending", "active", "paused", "revoked", "expired", "failed"]);

export const createdConsentSchema = z.object({
  handle: z.string().min(1).max(500),
  // The consent screen must be reached over https.
  redirectUrl: z
    .string()
    .max(2000)
    .refine((u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    }, "redirectUrl must be an https URL"),
  expiresAt: z.date(),
});

export const consentStateSchema = z.object({
  status: statusSchema,
  accounts: z
    .array(
      z.object({
        ref: z.string().min(1).max(200),
        bankName: z.string().trim().min(1).max(60),
        last4: z.string().regex(/^[0-9A-Za-z]{4}$/),
        instrument: z.enum(["account", "card"]),
      })
    )
    .max(50),
  expiresAt: z.date().optional(),
});

/** One transaction. Parsed one by one, so a bad entry is skipped and counted rather than failing the page. */
export const transactionSchema = z.object({
  id: z.string().min(1).max(200),
  accountRef: z.string().max(200),
  type: z.enum(["income", "expense"]),
  amountMinor: z.number().int().min(1).max(MAX_MINOR_AMOUNT),
  currency: z.string().min(1).max(8),
  at: z.date(),
  narration: z.string().max(2000).default(""),
  reference: z.string().max(60).optional(),
});

export const fetchPageSchema = z.object({
  transactions: z.array(z.unknown()).max(1000),
  nextCursor: z.string().min(1).max(200).optional(),
});
