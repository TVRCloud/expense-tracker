// The shared steps every bank parser runs: find the amount, the direction, the account, the date, the other party
// and the reference, then score how sure the read is. A bank parser subclasses this, names the senders it owns and
// overrides only the steps where its wording differs. The generic parser (generic.ts) is this class with no senders.

import { parseMessageDate, type ParsedDate } from "./dates";
import { findAmount, type FoundAmount } from "./extract/amount";
import { findBankName, findLast4, findPaidCard, type FoundAccount } from "./extract/account";
import { findDirection, isAtmWithdrawal, isCardPayment, type FoundDirection } from "./extract/direction";
import { findMerchant, findRef } from "./extract/merchant";
import { normaliseSender } from "./sender";
import type { MoneyParse } from "./types";

/** A sender as the registry compares it: the DLT header in upper case and the app package in lower case. */
export interface NormalisedSource {
  header?: string;
  packageName?: string;
}

export abstract class BankParser {
  /** Stored as the parse's `parserId` ("hdfc", "generic"). */
  abstract readonly id: string;
  /** The bank's name on the parse; undefined lets the message text decide (the generic parser). */
  abstract readonly bankName: string | undefined;
  /** DLT headers this bank sends from, upper case, without the "VM-" prefix or the "-S" suffix ("HDFCBK"). */
  readonly senderIds: readonly string[] = [];
  /** Android packages of the bank's apps, for notification captures. */
  readonly packageNames: readonly string[] = [];
  /** Added to the score when this parser reads a message: a known bank's wording is surer than the generic guess.
   * The sender is what the phone reports, not proof, so a bank parser that sets a bonus should earn it from its own
   * wording (override the steps), never from the sender alone. The foreign-currency and bill-payment caps still apply. */
  protected readonly confidenceBonus: number = 0;

  /** Whether this bank sent the message. The lists are normalised here, so "VM-HDFCBK" or a mixed-case package in a
   * subclass still matches. */
  canHandle(source: NormalisedSource): boolean {
    if (source.header && this.senderIds.some((id) => normaliseSender(id) === source.header)) return true;
    return !!source.packageName && this.packageNames.some((p) => p.trim().toLowerCase() === source.packageName);
  }

  /** The money in a message, or null when this parser cannot read it. Null means "not mine": the next parser (the
   * generic one) still tries, so a bank parser cannot veto a message; anything that must never be booked belongs in
   * ignore.ts. */
  parse(text: string, receivedAt: Date): MoneyParse | null {
    const amount = this.amount(text);
    const cardPayment = this.cardPayment(text);
    const direction = cardPayment ? { type: "income" as const, ambiguous: false } : this.direction(text);
    if (!amount || !direction) return null;

    // A card bill payment names the card it paid; otherwise the account the money moved on.
    const account = (cardPayment ? this.paidCard(text) : null) ?? this.account(text, direction.type);
    const parsedDate = this.date(text, receivedAt);
    const ref = this.ref(text);
    const merchant = this.merchant(text, direction.type);

    let confidence = 0.35 + 0.25; // amount + direction
    if (account) confidence += 0.25;
    if (parsedDate) confidence += 0.1;
    if (ref || merchant) confidence += 0.05;
    if (direction.ambiguous) confidence -= 0.15;
    confidence += this.confidenceBonus;
    // Charged abroad: today's rate is not what the bank billed, so the person confirms the rupee amount.
    if (amount.currency !== "INR") confidence = Math.min(confidence, 0.6);
    // Paying a card bill is a move between the person's own accounts: always reviewed, never booked as income.
    if (cardPayment) confidence = Math.min(confidence, 0.5);

    return {
      kind: "money",
      parserId: this.id,
      confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
      type: direction.type,
      amountMinor: amount.minor,
      currency: amount.currency,
      last4: account?.last4,
      instrument: cardPayment ? "card" : account?.instrument,
      merchant,
      ref,
      bankName: this.bankName ?? findBankName(text),
      date: parsedDate?.date,
      hasTime: parsedDate?.hasTime ?? false,
      ...(direction.type === "expense" && this.atm(text) ? { atm: true as const } : {}),
      ...(cardPayment ? { cardPayment: true as const } : {}),
    };
  }

  // The steps below are what a bank parser overrides. Each falls back to the shared rule.

  protected amount(text: string): FoundAmount | null {
    return findAmount(text);
  }

  protected direction(text: string): FoundDirection | null {
    return findDirection(text);
  }

  protected cardPayment(text: string): boolean {
    return isCardPayment(text);
  }

  protected account(text: string, type: "income" | "expense"): FoundAccount | null {
    return findLast4(text, type);
  }

  /** The card a bill payment went to. */
  protected paidCard(text: string): FoundAccount | null {
    return findPaidCard(text);
  }

  protected date(text: string, receivedAt: Date): ParsedDate | null {
    return parseMessageDate(text, receivedAt);
  }

  protected merchant(text: string, type: "income" | "expense"): string | undefined {
    return findMerchant(text, type);
  }

  protected ref(text: string): string | undefined {
    return findRef(text);
  }

  protected atm(text: string): boolean {
    return isAtmWithdrawal(text);
  }
}
