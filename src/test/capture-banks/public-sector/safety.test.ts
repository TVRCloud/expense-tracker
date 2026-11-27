import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 171: the phase 8 safety rules, for every public sector bank parser. Invented messages only.
const BANKS = [
  { id: "canara", sender: "VM-CANBNK-S", name: "Canara Bank" },
  { id: "pnb", sender: "VM-PNBSMS-S", name: "PNB" },
  { id: "bob", sender: "AD-BOBTXN-S", name: "Bank of Baroda" },
  { id: "union", sender: "JM-UNIONB-S", name: "Union Bank of India" },
  { id: "boi", sender: "BZ-BOIIND-S", name: "Bank of India" },
  { id: "central", sender: "CP-CENTBK-S", name: "Central Bank of India" },
  { id: "indian", sender: "AD-INDBNK-S", name: "Indian Bank" },
  { id: "iob", sender: "VM-IOBCHN-S", name: "Indian Overseas Bank" },
  { id: "uco", sender: "VK-UCOBNK-S", name: "UCO Bank" },
  { id: "psb", sender: "JD-PSBANK-S", name: "Punjab & Sind Bank" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;

/** Messages that move no money yet, or move it between the person's own accounts. `ok` is the only type that may be
 * booked without Review; left out, nothing may be. */
function tricky(bank: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.3,815.00 done at ${bank} CDM in A/c X2738 on 05Nov26.`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.395.00 initiated to ${bank} Card 2738 by MARKETCO on 2026-11-04. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.622 on ${bank} Card 2738 at STORECO On 2026-11-04 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${bank} Credit Card 2738 payment of Rs.8,740.00 has been received on 05-11-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 4,860.00 from A/c ****2738 to ${bank} Credit Card XX7146 via ${bank} NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX2738 debited for Rs 8,615.00 on 05-Nov-26; ${bank} Credit Card XX7146 credited. UPI:631977001122.` },
    { name: "credit card bill debit", text: `INR 8,930.00 debited from A/c no. XX442738 on CREDIT CARD BILL PAYMENT 05-11-2026 10:14:08 IST. - ${bank}` },
    { name: "mandate set-up", text: `${bank} Acct XX2738 credited Rs 1.85 on 05-Nov-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 285.00 from A/c XX2738 to STORECO has failed. -${bank}` },
    { name: "OTP", text: `519304 is your OTP for a payment of Rs 845.00 at STORECO. Do not share. -${bank}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 247.00 will be debited from A/c XX2738 on 07-11-26 for VideoCo. -${bank}` },
  ];
}

describe.each(BANKS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    const text = "Rs.238.00 debited from A/c XX2738 to VPA kiosk.two@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    expect(own.parserId).toBe(id);
    expect(own.confidence).toBe(generic(text, RECEIVED, { sender }).confidence);
    expect(own.confidence).toBeLessThan(1);
  });

  it("a debit naming two accounts is booked on the payer's", () => {
    const text = "Your a/c no. XXXXXXXX2738 is debited for Rs.365.00 on 05-11-26 and a/c XXXXXX8812 credited (IMPS Ref no 631977002233).";
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", type: "expense", last4: "2738" });
  });

  it("never takes a loan account's digits", () => {
    for (const text of [
      "Rs 2,145.00 debited from your A/c XX2738 for loan a/c no XX6702 EMI on 05-11-26.",
      "Your loan account XX6702 is credited with Rs 2,145.00 by debit to A/c XX2738 on 05-11-26.",
    ]) {
      const p = parseCapture(text, RECEIVED, { sender });
      expect(p.kind === "money" && p.last4).not.toBe("6702");
    }
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `Dear Customer, Acct XXX482 Dr. INR 5 on 04/11/26 to ${"a ".repeat(2500)}; UPI: 1`,
      `An amount of INR 5 has been credited to XXXX3917 by Sender ${"x".repeat(5000)}`,
      `A/c X6731 debited INR 5 Dt 04-11-26 to ${"to a ".repeat(1000)} thru UPI`,
      `A/c XX6731 debited with Rs.5 thru card XX5108 ${" ".repeat(5000)} PNB ATM`,
      `Rs.5 transferred from A/c ...7193 to:${"a".repeat(5000)}`,
      `Rs.5 Dr. from A/c XX${"7".repeat(5000)}`,
      `Union Bank of India A/c*5093 Dr Rs5 by MB 660 ${"a ".repeat(2500)},`,
      `Rs.5 debited A/cXX2846 and credited to ${"a ".repeat(2500)} via`,
      `BOI - Rs 5 Credited By NEFTINWARD X/${"a".repeat(5000)}`,
      `Rs. 5 credited to your A/c xxxxxx7719 By.${"a ".repeat(2500)}-CBoI`,
      `Sent Rs.5 from A/c *6614 on 04-11-26 to ${"a ".repeat(2500)}.RRN 1`,
      `Rs. 5 credited UTR:X/NEFT/${"a ".repeat(2500)}`,
      `A/C No **7326 Credited with Rs 5--NEFT/N1234/${"a ".repeat(2500)}(`,
      `A/c No **7326 Debited with Rs 5--UPI/DR/918273/${"a".repeat(5000)}`,
    ];
    for (const text of pads) {
      const start = performance.now();
      parseCapture(text, RECEIVED, { sender });
      expect(performance.now() - start).toBeLessThan(250);
    }
  });
});
