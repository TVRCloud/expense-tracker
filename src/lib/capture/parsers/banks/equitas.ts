// Equitas Small Finance Bank. The account is written with its plain last four digits after the bank's name
// ("debited via UPI from Equitas A/c 7302", "debited from Equitas-7302", "credited via UPI to Equitas A/c 7302"),
// which the shared reader (it needs a mask) does not see. The digits are taken only beside the verb that matches the
// money's direction, never after "by debit to". The payee is read only from "-Ref:<ref> [on <date>] to <payee>"
// (a payer: "from <payer>"), because the shared reader takes "Equitas-7302" or the help line's number. A deposit, RD
// or loan credited by a debit from the account moves money between the person's own accounts: Review. Ticket 173.

import type { FoundAccount } from "../extract/account";
import type { MoneyParse } from "../types";
import { NAME, REVIEW_CEILING, sharedParty } from "./known";
import { maskOrNumber, SmallFinanceParser } from "./small-finance-helpers";

const PLAIN = /\bEquitas(?:-|\s(?:Loan\s)?A\/c\s)\d{4}(?![.,]?\d)/i;
const PLAIN_ALL = /\bEquitas(?:-|\s(?:Loan\s|FD\s|RD\s)?A\/c\s)(\d{4})(?![.,]?\d)/gi;
const DEBITED = /\bdebited\s(?:via\s(?:UPI|IMPS|NEFT|RTGS)\s)?from\sEquitas(?:-|\sA\/c\s)(\d{4})(?![.,]?\d)/i;
const CREDITED =
  /\bcredited\s(?:via\s(?:UPI|IMPS|NEFT|RTGS)\s)?to\sEquitas\sA\/c\s(\d{4})(?![.,]?\d)|\bEquitas\sA\/c\s(\d{4})\s(?:is\s|has\sbeen\s)?credited\b/i;
const PAYEE = new RegExp(String.raw`-Ref:\s?\w{6,22}\s(?:on\s\S{1,12}\s)?to\s${NAME}(?=\son\b|\.(?:\s|$|[A-Z])|$)`, "i");
const PAYER = new RegExp(String.raw`-Ref:\s?\w{6,22}\s(?:on\s\S{1,12}\s)?from\s${NAME}(?=\son\b|\.(?:\s|$|[A-Z])|$)`, "i");
const OWN_TRANSFER =
  /\bby\sdebit\s(?:to|from)\b|\bcredited\sto\s(?:your\s)?(?:Equitas\s)?(?:RD|FD|recurring\sdeposit|fixed\sdeposit|deposit|loan|PPF)\b/i;

export class EquitasParser extends SmallFinanceParser {
  readonly id = "equitas";
  readonly bankName = "Equitas Small Finance Bank";
  override readonly senderIds = ["EQUTAS", "EQUITA"];

  protected readonly shapes = [
    /^INR\s[\d,.]{1,15}\s(?:debited\svia\sUPI\sfrom|credited\svia\sUPI\sto)\sEquitas\sA\/c\s\d{4}\b/i,
    /^INR\s[\d,.]{1,15}\sdebited\sfrom\sEquitas-\d{4}\svia\sUPI\b/i,
  ];

  override parse(text: string, receivedAt: Date): MoneyParse | null {
    const parse = super.parse(text, receivedAt);
    // Only in the bank's own wording: a shared-shape loan EMI ("loan a/c … credited … by debit to A/c XX7305") is read
    // by the shared loan rule as an expense and keeps its score.
    const flat = text.replace(/\s+/g, " ");
    // Two different Equitas accounts in one message ("from Equitas A/c 4419 … to Equitas A/c 5521") is a move between
    // the person's own accounts too.
    const own = new Set([...flat.matchAll(PLAIN_ALL)].map((m) => m[1]));
    if (parse && PLAIN.test(flat) && (OWN_TRANSFER.test(flat) || own.size > 1) && parse.confidence > REVIEW_CEILING) {
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
    const v = (own ? text.match(type === "expense" ? PAYEE : PAYER)?.[1] : sharedParty(super.merchant(text, type)))
      ?.replace(/\s(?:is|has\sbeen|has|was)\s(?:reversed|failed|declined|refunded)\b.{0,80}$/i, "")
      .trim();
    return v && /[A-Za-z]/.test(v) && !maskOrNumber(v) ? v.slice(0, 60) : undefined;
  }
}
