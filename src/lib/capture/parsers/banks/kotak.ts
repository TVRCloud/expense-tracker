// Kotak Mahindra Bank. A UPI payee is often a UPI id made of digits ("to 98xxxxxx01@paytm"), which the shared rule
// skips as a phone number; a card spend through UPI reads "at UPI-<ref>-<payee>"; a refund names the shop before
// "refunded" ("INR 20 from SHOP refunded to your Kotak Credit Card").

import { cleanParty, KnownBankParser, sharedParty, vpaAfter } from "./known";

export class KotakParser extends KnownBankParser {
  readonly id = "kotak";
  readonly bankName = "Kotak Mahindra Bank";
  override readonly senderIds = ["KOTAKB", "KOTAKD", "KBANKT"];
  override readonly packageNames = ["com.msf.kbank.mobile"];

  protected readonly shapes = [
    /^Sent\s+Rs\.?\s*[\d,.]+\s+from\s+(?:Kotak\s+Bank\s+A\/?C\s+X\d{4}|X+\d{4})\s+to\s/i,
    /^Received\s+Rs\.?\s*[\d,.]+\s+(?:on\s+\S+\s+)?in\s+your\s+Kotak\s+Bank\s+A\/?C\s+x\d{4}\b/i,
    /\bspent\s+on\s+Kotak\s+Credit\s+Card\s+x\d{4}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const upiCard = text.match(/\bat\s+UPI-\d+-(.+?)(?:\.\s|\.$|\s+Avl\b|$)/i);
    const refunded = text.match(/\bfrom\s+(.+?)\s+refunded\b/i);
    return (
      vpaAfter(type === "expense" ? "to" : "from", text) ??
      cleanParty(upiCard?.[1]) ??
      cleanParty(refunded?.[1]) ??
      sharedParty(super.merchant(text, type))
    );
  }

  protected override ref(text: string): string | undefined {
    return text.match(/\bUPI-(\d{12})-/)?.[1] ?? super.ref(text);
  }
}
