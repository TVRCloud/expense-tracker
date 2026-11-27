import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 174: the phase 8 safety rules for the foreign banks in India. Invented messages only.
const BANKS = [
  { id: "hsbc", sender: "VM-HSBCIN-S", name: "HSBC" },
  { id: "standard_chartered", sender: "AD-SCBANK-S", name: "Standard Chartered" },
  { id: "dbs", sender: "VM-DBSBNK-S", name: "DBS Bank" },
  { id: "amex", sender: "AD-AMEXIN-S", name: "American Express" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;

function tricky(bank: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.3,640.00 done at ${bank} CDM in A/c X6218 on 14Oct26.`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.385.00 initiated to ${bank} Card 6218 by PANTRYCO on 2026-10-13. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.462 on ${bank} Card 6218 at SHOPLY On 2026-10-13 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${bank} Credit Card 6218 payment of Rs.7,730.00 has been received on 14-10-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 4,860.00 from A/c ****6218 to ${bank} Credit Card XX3374 via ${bank} NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX6218 debited for Rs 8,415.00 on 14-Oct-26; ${bank} Credit Card XX3374 credited. UPI:629300117733.` },
    { name: "credit card bill debit", text: `INR 8,940.00 debited from A/c no. XX436218 on CREDIT CARD BILL PAYMENT 14-10-2026 10:12:31 IST. - ${bank}` },
    { name: "mandate set-up", text: `${bank} Acct XX6218 credited Rs 3.00 on 14-Oct-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 284.00 from A/c XX6218 to SHOPLY has failed. -${bank}` },
    { name: "OTP", text: `730418 is your OTP for a payment of Rs 689.00 at SHOPLY. Do not share. -${bank}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 247.00 will be debited from A/c XX6218 on 16-10-26 for TuneCo. -${bank}` },
  ];
}

describe.each(BANKS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    const text = "Rs.233.00 debited from A/c XX6218 to VPA stall.two@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    const plain = generic(text, RECEIVED, { sender });
    expect(own.parserId).toBe(id);
    expect(own.confidence).toBe(plain.confidence);
  });

  it("a debit naming two accounts is booked on the payer's", () => {
    const p = parseCapture(
      "Your a/c no. XXXXXXXX6218 is debited for Rs.530.00 on 14-10-26 and a/c XXXXXX4417 credited (IMPS Ref no 629300554466).",
      RECEIVED,
      { sender }
    );
    expect(p).toMatchObject({ kind: "money", type: "expense", last4: "6218" });
  });

  it("never takes a loan account's digits", () => {
    const p = parseCapture("Your loan a/c no XX7093 is credited with Rs 3,115.00 by debit to A/c XX6218 on 14-10-26.", RECEIVED, { sender });
    expect(p.kind === "money" && p.last4).not.toBe("7093");
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `HSBC: A/c 1-1*** ${" ".repeat(5000)}-1 is credited with INR 5`,
      `HSBC: your NEFT transaction ${"for INR 5.00 ".repeat(400)} has been credited to the X`,
      `has been credited to the ${"a ".repeat(2500)}A/c XX1111 of x`,
      `Rs 5 credited as NEFT from ${"x ".repeat(2500)} A/c ***1 of y`,
      `Your HSBC creditcard xx1111 used at ${"a ".repeat(2500)}for INR 5`,
      `Thank you for using HSBC Debit Card XX at ${"b ".repeat(2500)}.`,
      `INR 5 paid from account ${"X".repeat(5000)} to y on 1`,
      `Dear Customer, there is an NEFT credit of INR 5 in your account ${"1".repeat(5000)}x1111`,
      `You've spent INR 5 on your AMEX card ** 11111 at ${"c ".repeat(2500)}on 1 May`,
      `AMEX card ${"*".repeat(5000)} 1111`,
    ];
    for (const { sender: s } of BANKS) {
      for (const text of pads) {
        const start = performance.now();
        parseCapture(text, RECEIVED, { sender: s });
        expect(performance.now() - start, text.slice(0, 40)).toBeLessThan(250);
      }
    }
  });
});
