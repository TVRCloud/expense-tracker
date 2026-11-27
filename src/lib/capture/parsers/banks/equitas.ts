// Equitas Small Finance Bank. The account is written with its plain last four digits after the bank's name
// ("debited via UPI from Equitas A/c 7302", "debited from Equitas-7302", "credited via UPI to Equitas A/c 7302"),
// which the shared reader (it needs a mask) does not see. The digits are taken only beside the verb that matches the
// money's direction, never after "by debit to". The payee is read only from "-Ref:<ref> [on <date>] to <payee>"
// (a payer: "from <payer>"), because the shared reader takes "Equitas-7302" or the help line's number. A deposit, RD
// or loan credited by a debit from the account moves money between the person's own accounts: Review. Ticket 173.

import type { FoundAccount } from "../extract/account";
import type { MoneyParse } from "../types";
import { KnownBankParser, NAME, REVIEW_CEILING, sharedParty } from "./known";
import { maskOrNumber } from "./small-finance-helpers";

const PLAIN = /\bEquitas(?:-|\s(?:Loan\s)?A\/c\s)\d{4}(?![.,]?\d)/i;
const DEBITED = /\bdebited\s(?:via\sUPI\s)?from\sEquitas(?:-|\sA\/c\s)(\d{4})(?![.,]?\d)/i;
const CREDITED = /\bcredited\s(?:via\sUPI\s)?to\sEquitas\sA\/c\s(\d{4})(?![.,]?\d)|\bEquitas\sA\/c\s(\d{4})\s(?:is\s|has\sbeen\s)?credited\b/i;
const PAYEE = new RegExp(String.raw`-Ref:\s?\w{6,22}\s(?:on\s\S{1,12}\s)?to\s${NAME}(?=\son\b|\.(?:\s|$|[A-Z])|$)`, "i");
const PAYER = new RegExp(String.raw`-Ref:\s?\w{6,22}\s(?:on\s\S{1,12}\s)?from\s${NAME}(?=\son\b|\.(?:\s|$|[A-Z])|$)`, "i");
const OWN_TRANSFER =
  /\bby\sdebit\s(?:to|from)\b|\bcredited\sto\s(?:your\s)?(?:Equitas\s)?(?:RD|FD|recurring\sdeposit|fixed\sdeposit|deposit|loan|PPF)\b/i;

export class EquitasParser extends KnownBankParser {
  readonly id = "equitas";
  readonly bankName = "Equitas Small Finance Bank";
  override readonly senderIds = ["EQUTAS", "EQUITA"];

  protected readonly shapes = [
    /^INR\s[\d,.]{1,15}\s(?:debited\svia\sUPI\sfrom|credited\svia\sUPI\sto)\sEquitas\sA\/c\s\d{4}\b/i,
    /^INR\s[\d,.]{1,15}\sdebited\sfrom\sEquitas-\d{4}\svia\sUPI\b/i,
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    if (parse && OWN_TRANSFER.test(text.replace(/\s+/g, " ")) && parse.confidence > REVIEW_CEILING) {
      return { ...parse, confidence: REVIEW_CEILING };
    }
    return parse;
  }

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // The bank's own way of writing the account: digits only beside the matching verb, nothing otherwise. A message
    // without it (a masked "A/c XX1234") is read by the shared rule, which already follows the direction.
    if (!PLAIN.test(text)) return super.account(text, type);
    const m = type === "expense" ? text.match(DEBITED) : text.match(CREDITED);
    const digits = m?.[1] ?? m?.[2];
    return digits ? { last4: digits, instrument: "account" } : null;
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    // In the bank's own wording the payee sits only after the reference; the shared reader would take "Equitas-4419"
    // or the help line's number. Elsewhere the shared reader runs, minus masks and numbers.
    const own = PLAIN.test(text) || /-Ref:\s?\w{6,22}\b/i.test(text);
    const v = own ? text.match(type === "expense" ? PAYEE : PAYER)?.[1]?.trim() : sharedParty(super.merchant(text, type));
    return v && /[A-Za-z]/.test(v) && !maskOrNumber(v) ? v.slice(0, 60) : undefined;
  }
}
