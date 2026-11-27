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
      expect(performance.now() - start).toBeLessThan(250);
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

describe("card bills paid from a bank account", () => {
  const cases: { name: string; sender: string; text: string; last4?: string }[] = [
    {
      name: "Axis: debited for a credit card bill",
      sender: "AX-AXISBK-S",
      text: "INR 8,615.00 debited from A/c no. XX441907 on CREDIT CARD BILL PAYMENT 04-10-2026 09:48:21 IST. Avl bal: INR 3,077.00 - Axis Bank",
    },
    {
      name: "IDFC: debited towards a credit card bill",
      sender: "BM-IDFCFB-S",
      text: "Your A/C XXXXX9283 is debited by INR 3,940.00 on 04/10/26 towards credit card bill. New Bal :INR 1,212.40",
    },
    {
      name: "ICICI: a card bill after Info",
      sender: "AX-ICICIT-S",
      text: "ICICI Bank Acct XX274 debited for Rs 10,480.00 on 04-Oct-26 InfoBIL*ICICI Card 3391. Avl Bal Rs 5,220.",
    },
    {
      name: "ICICI: paid by UPI to the card, which names its own digits",
      sender: "AX-ICICIT-S",
      text: "ICICI Bank Acct XX274 debited for Rs 8,470.00 on 04-Oct-26; ICICI Bank Credit Card XX3391 credited. UPI:604400126655.",
      last4: "3391",
    },
  ];

  it.each(cases)("$name: a card payment that never carries the debited account's digits", ({ sender, text, last4 }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", cardPayment: true, type: "income", last4, instrument: last4 ? "card" : undefined });
    if (!last4) expect(p.kind === "money" && p.last4).toBeFalsy();
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });
});

describe("promo or help text about card bills never turns a spend into a card payment", () => {
  const cases: { name: string; sender: string; text: string; merchant: string }[] = [
    {
      name: "Axis card spend with a pay-your-bill line",
      sender: "AX-AXISBK-S",
      text: "Spent INR 640 using Axis Bank Credit Card no. XX2208 on 04-10-26 13:22:09 IST at HOTEL SAFFRON. Avl limit: INR 58,100.00. Pay your credit card bill to Axis Bank Credit Card easily.",
      merchant: "HOTEL SAFFRON",
    },
    {
      name: "Kotak card spend with a pay-to-card line",
      sender: "JD-KOTAKB-S",
      text: "INR 715 spent on Kotak Credit Card x6047 on 04-OCT-2026 at SHOPWAVE. Avl limit INR 40,535.00. Use the app to pay to your Kotak credit card.",
      merchant: "SHOPWAVE",
    },
    {
      name: "HDFC card spend with an offer line",
      sender: "VM-HDFCBK-S",
      text: "Spent Rs.355.00 On HDFC Bank Card 5150 At ..METRO MART On 2026-10-04:18:10:33. Earn 5% back when you pay to HDFC Bank Credit Card bills.",
      merchant: "METRO MART",
    },
    {
      name: "a payee named Credit Card Services is a merchant",
      sender: "VM-HDFCBK-S",
      text: "Rs.275.00 debited from A/c XX5150 on 04-10-26 to ACME Credit Card Services. UPI Ref 604400127788.",
      merchant: "ACME Credit Card Services",
    },
  ];

  it.each(cases)("$name", ({ sender, text, merchant }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", type: "expense", merchant });
    expect(p.kind === "money" && p.cardPayment).toBeFalsy();
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });
});

describe("SBI card spend written 'done at SHOP on your card'", () => {
  it("reads a spend abroad and keeps it in Review", () => {
    const p = parseCapture("Trxn. of USD 11.49 done at CLOUDAPP on your SBI Credit Card ending 7731 on 04/10/26.", RECEIVED, {
      sender: "VM-SBICRD",
    });
    expect(p).toMatchObject({ kind: "money", parserId: "sbi", type: "expense", currency: "USD", amountMinor: 1149, last4: "7731", merchant: "CLOUDAPP" });
    expect(p.confidence).toBeLessThanOrEqual(0.6);
  });
});
