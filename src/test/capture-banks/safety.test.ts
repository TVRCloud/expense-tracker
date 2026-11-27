import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "./helpers";
import { styled } from "./styled";

// Ticket 155 review: rules every bank parser must keep. Invented messages only.
const BANKS = [
  { id: "hdfc", sender: "VM-HDFCBK-S", name: "HDFC Bank" },
  { id: "icici", sender: "AX-ICICIT-S", name: "ICICI Bank" },
  { id: "sbi", sender: "JD-SBIINB-S", name: "SBI" },
  { id: "axis", sender: "AX-AXISBK-S", name: "Axis Bank" },
  { id: "kotak", sender: "JD-KOTAKB-S", name: "Kotak Bank" },
  { id: "idfc", sender: "BM-IDFCFB-S", name: "IDFC FIRST Bank" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;

/** Messages that move no money yet, or move it between the person's own accounts. `ok` is the only type that may
 * be booked without Review; left out, nothing may be. */
function tricky(bank: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.4,260.00 done at ${bank} CDM in A/c X5150 on 03Oct26.`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.410.00 initiated to ${bank} Card 5150 by GROCERYCO on 2026-10-02. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.537 on ${bank} Card 5150 at SHOPCO On 2026-10-02 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${bank} Credit Card 5150 payment of Rs.9,100.00 has been received on 03-10-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 5,200.00 from A/c ****5150 to ${bank} Credit Card XX9071 via ${bank} NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX5150 debited for Rs 9,125.00 on 03-Oct-26; ${bank} Credit Card XX6604 credited. UPI:604400118899.` },
    { name: "credit card bill debit", text: `INR 9,450.00 debited from A/c no. XX550917 on CREDIT CARD BILL PAYMENT 03-10-2026 10:02:44 IST. - ${bank}` },
    { name: "mandate set-up", text: `${bank} Acct XX5150 credited Rs 3.00 on 03-Oct-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 315.00 from A/c XX5150 to SHOPCO has failed. -${bank}` },
    { name: "OTP", text: `604213 is your OTP for a payment of Rs 765.00 at SHOPCO. Do not share. -${bank}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 213.00 will be debited from A/c XX5150 on 05-10-26 for StreamCo. -${bank}` },
  ];
}

describe.each(BANKS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    // A plain message in no bank's own shape: the bank parser reads it, scoring exactly like the generic parser.
    const text = "Rs.215.00 debited from A/c XX5150 to VPA kiosk.one@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    const plain = generic(text, RECEIVED, { sender });
    expect(own.parserId).toBe(id);
    expect(own.confidence).toBe(plain.confidence);
    expect(own.confidence).toBeLessThan(1);
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `Spent Rs.5 On ${name} Card 5150 ${" ".repeat(5000)} At x On 2026-10-03`,
      `Rs 5 debited Acct XX274 Info${"-".repeat(5000)}`,
      `Rs 5 debited ${"to a ".repeat(1000)} via ${name} NetBanking`,
      `Rs 5 debited A/c no. X on ${"a ".repeat(2500)}`,
      `Rs 5 debited ${"; ".repeat(2500)} credited`,
      `Rs 5 spent using ${name} Card XX5150 on x on ${" ".repeat(5000)}a`,
      `Rs 5 debited ${"10:10:10 IST a ".repeat(330)} Avl Limit`,
    ];
    for (const text of pads) {
      const start = performance.now();
      parseCapture(text, RECEIVED, { sender });
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
});

describe("styled letters for every sender", () => {
  it("ignores an OTP written partly in styled letters", () => {
    const text = `Rs 615 debited from A/c X7731 on 03Oct26 to RAJ ${styled("OTP 583104 do not share")}`;
    for (const sender of ["VM-HDFCBK", "JD-SBIINB", "VM-OTHRBK", undefined]) {
      expect(parseCapture(text, RECEIVED, { sender })).toMatchObject({ kind: "ignored", reason: "otp" });
    }
  });
});
