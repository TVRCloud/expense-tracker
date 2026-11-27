// Kotak Mahindra Bank. A UPI payee is often a UPI id made of digits ("to 90xxxxxx12@ybl"), which the shared rule skips
// as a phone number; a card spend through UPI reads "at UPI-<ref>-<payee>"; a refund names the shop before "refunded"
// ("INR 60 from SHOP refunded to your Kotak Credit Card").

import { cleanParty, KnownBankParser, NAME, sharedParty, vpaAfter } from "./known";

export class KotakParser extends KnownBankParser {
  readonly id = "kotak";
  readonly bankName = "Kotak Mahindra Bank";
  override readonly senderIds = ["KOTAKB", "KOTAKD"];
  override readonly packageNames = ["com.msf.kbank.mobile"];

  protected readonly shapes = [
    /^Sent\sRs\.?\s?[\d,.]{1,15}\sfrom\s(?:Kotak\sBank\sA\/?C\sX\d{4}|X{1,8}\d{4})\sto\s/i,
    /^Received\sRs\.?\s?[\d,.]{1,15}\s(?:on\s\S{1,12}\s)?in\syour\sKotak\sBank\sA\/?C\sx\d{4}\b/i,
    /\bspent\son\sKotak\sCredit\sCard\sx\d{4}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const upiCard = text.match(new RegExp(String.raw`\bat\sUPI-\d{6,22}-${NAME}(?:\.\s|\.$|\sAvl\b|$)`, "i"));
    const refunded = text.match(new RegExp(String.raw`\bfrom\s${NAME}\srefunded\b`, "i"));
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
