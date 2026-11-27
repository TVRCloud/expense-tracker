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
      // Ticket 156: the balance and limit readers.
      `Rs 5 debited A/c XX5150 Avl Bal${" ".repeat(5000)}Rs 5`,
      `Rs 5 debited A/c XX5150 Avl Lmt${":".repeat(5000)}INR 5`,
      `Rs 5 debited A/c XX5150 ${"Min Bal ".repeat(700)}Rs 5`,
      // Ticket 157: the mandate and fund house readers.
      `Your mandate for ${"a ".repeat(2500)} has been created`,
      `mandate created towards ${"x".repeat(5000)}`,
      `SIP processed in ${"Big ".repeat(1200)}Fund NAV ${"1".repeat(3000)}.5`,
      `units allotted folio ${"9".repeat(5000)} fund`,
      `Your loan account ${"x".repeat(5000)}1 credited Rs 5 by debit to A/c XX5150`,
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

describe("a card bill payment whose card is named in the next sentence", () => {
  const cases = [
    {
      sender: "AX-ICICIT-S",
      text: "ICICI Bank Acct XX274 debited for Rs 6,215.00 on 05-Oct-26. ICICI Bank Credit Card XX3391 credited. UPI:604400131313.",
      last4: "3391",
    },
    {
      sender: "VM-HDFCBK-S",
      text: "Rs.4,780.00 debited from A/c XX5150 on 05-10-26. Towards HDFC Bank Credit Card XX6047. Ref 604400132424.",
      last4: "6047",
    },
    {
      sender: "AX-AXISBK-S",
      text: "INR 7,360.00 debited from A/c no. XX441907 on 05-10-26. Paid to Axis Bank Credit Card XX2208. - Axis Bank",
      last4: "2208",
    },
    {
      sender: "BM-IDFCFB-S",
      text: "Your A/C XXXXX9283 is debited by INR 5,905.00 on 05/10/26. Paid towards your IDFC FIRST Bank Credit Card XX7716. New Bal :INR 880.40",
      last4: "7716",
    },
  ];

  it.each(cases)("$sender: a card payment with the card's digits", ({ sender, text, last4 }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", cardPayment: true, last4, instrument: "card" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("a promo sentence after a debit is still not read as a card payment", () => {
    const p = parseCapture(
      "Rs.212.00 debited from A/c XX5150 on 05-10-26 to VPA tiffin.box@ybl. Pay your HDFC Bank Credit Card bill on time to earn points.",
      RECEIVED,
      { sender: "VM-HDFCBK-S" }
    );
    expect(p).toMatchObject({ kind: "money", type: "expense", merchant: "tiffin.box@ybl" });
    expect(p.kind === "money" && p.cardPayment).toBeFalsy();
  });

  // A next sentence counts only when it names a card by its masked digits: a promo line that does not start with a
  // promo verb is still never where the money went.
  it.each([
    {
      sender: "VM-HDFCBK-S",
      text: "Rs.318.00 debited from A/c XX5150 to ORCHARD BAKERY on 05-10-26. Now you can pay to your HDFC Bank Credit Card via UPI.",
      type: "expense",
    },
    {
      sender: "AX-ICICIT-S",
      text: "ICICI Bank Acct XX274 debited for Rs 147.00 on 05-Oct-26; BLUE KETTLE credited. To pay your credit card bill, use iMobile.",
      type: "expense",
    },
    {
      sender: "VM-HDFCBK-S",
      text: "Rs.6,420.00 credited to HDFC Bank A/c XX5150 on 05-10-26 from MEERA NAIR. Towards your credit card goals, save more.",
      type: "income",
    },
  ])("$sender: a promo line after the money sentence leaves a $type alone", ({ sender, text, type }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", type });
    expect(p.kind === "money" && p.cardPayment).toBeFalsy();
    expect(p.kind === "money" && p.instrument).not.toBe("card");
    // Never pushed to Review as a card payment: at least as sure as the generic parser.
    expect(p.confidence).toBeGreaterThanOrEqual(generic(text, RECEIVED, { sender }).confidence);
  });

  it("a fee for a card payment is an expense, not a card payment", () => {
    const p = parseCapture("Rs.236.00 debited from A/c XX5150 on 05-10-26 for credit card payment charges. Ref 604400135757.", RECEIVED, {
      sender: "VM-HDFCBK-S",
    });
    expect(p).toMatchObject({ kind: "money", type: "expense" });
    expect(p.kind === "money" && p.cardPayment).toBeFalsy();
  });

  it("reads 'Credit Card Payment XX…' in the next sentence as a card payment", () => {
    const p = parseCapture("Rs.3,975.00 debited from A/c XX5150 on 05-10-26. Info: Credit Card Payment XX6047.", RECEIVED, {
      sender: "VM-HDFCBK-S",
    });
    expect(p).toMatchObject({ kind: "money", cardPayment: true, last4: "6047" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });
});

describe("card bill payment received on the card keeps the card's digits", () => {
  it("HDFC", () => {
    const p = parseCapture("Your HDFC Bank Credit Card 5150 payment of Rs.8,240.00 has been received on 05-10-26.", RECEIVED, {
      sender: "VM-HDFCBK-S",
    });
    expect(p).toMatchObject({ kind: "money", cardPayment: true, last4: "5150", instrument: "card" });
  });
});

describe("merchant filters", () => {
  it("a Kotak account written 'AC X1234' is never the merchant", () => {
    const p = parseCapture("Rs.420.00 credited to Kotak Bank AC X6047 on 05-10-26 by NEFT.", RECEIVED, { sender: "JD-KOTAKB-S" });
    expect(p.kind === "money" && p.merchant).toBeFalsy();
  });

  it("a payee called CREDIT CARD SVCS LTD is a merchant, not a card", () => {
    const p = parseCapture("Rs.318.00 debited from A/c XX5150 on 05-10-26 to CREDIT CARD SVCS LTD. UPI Ref 604400135656.", RECEIVED, {
      sender: "VM-HDFCBK-S",
    });
    expect(p).toMatchObject({ kind: "money", type: "expense", merchant: "CREDIT CARD SVCS LTD" });
    expect(p.kind === "money" && p.cardPayment).toBeFalsy();
  });
});
