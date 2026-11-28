// Indian Bank. The account is "a/c *6614"; a UPI debit reads "Sent Rs.612.00 from A/c *6614 on … to NAME.RRN <ref>";
// a NEFT credit names the sender between slashes ("UTR:<code>/NEFT/NAME /").

import type { FoundAccount } from "../extract/account";
import { cleanParty, NAME, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

export class IndianBankParser extends PublicSectorParser {
  readonly id = "indian";
  readonly bankName = "Indian Bank";
  override readonly senderIds = ["INDBNK"];
  override readonly packageNames = ["com.infrasofttech.indianbank"];

  protected readonly shapes = [
    /^Rs\.\s?[\d,.]{1,15}\scredited\sto\sa\/c\s\*\d{4}\son\s/i,
    /^Sent\sRs\.[\d,.]{1,15}\sfrom\sA\/c\s\*\d{4}\son\s/i,
    /\bUTR:[A-Za-z0-9]{4,30}\/NEFT\//i,
  ];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    const acct = text.match(/(?<!\b(?:loan|card)\s)\ba\/c\s\*(\d{4})\b/i);
    return acct ? { last4: acct[1], instrument: "account" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const sent = text.match(new RegExp(String.raw`\bto\s${NAME}\.RRN\b`, "i"));
    const neft = text.match(/\/NEFT\/([^/]{1,60}?)\s?\//i);
    if (sent || neft) return nameOnly(sent?.[1] ?? neft?.[1]);
    return nameOnly(sharedParty(super.merchant(text, type)));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bRRN\s(\d{12})\b/)?.[1] ?? super.ref(text);
  }
}
