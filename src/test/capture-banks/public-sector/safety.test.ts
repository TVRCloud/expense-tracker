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

// Ticket 171 review: the tricky cases written in each bank's OWN shapes, so a shape bonus or a bank reader cannot
// slip past them. `ok`: the only type that may be booked without Review; left out, nothing may be.
// `noAtm`: an ATM fee, never a cash withdrawal.
type Own = { text: string; ok?: "income" | "expense"; noAtm?: true };
const OWN: Record<string, { sender: string; cases: Own[] }> = {
  canara: {
    sender: "VM-CANBNK-S",
    cases: [
      { text: "Dear Customer, Acct XXX482 credited with INR 640.00 on 04-11-26 refund from SHOPKART, will be credited in 5-7 days; Bal INR 10,854.66-CanaraBank" },
      { text: "Dear Customer, Acct XXX482 Dr. INR 8,615.00 on 04/11/26 towards your Credit Card XX7146 bill payment-CanaraBank" },
      { text: "An amount of INR 2,135.00 has been credited to XXXX6610 on 04/11/2026 towards your Loan A/c from SB A/c XXXX3917 - Canara Bank" },
      { text: "Dear Customer, Acct XXX482 Dr. INR 319.40 on 04/11/26 to MANGO LANE STORES; UPI: 631702498119; Bal INR 8,214.66 Cr.-CanaraBank", ok: "expense" },
    ],
  },
  pnb: {
    sender: "VM-PNBSMS-S",
    cases: [
      { text: "A/c XX6731 debited with Rs.4,350.00 thru card XX5108 at PNB ATM, reversed as cash not dispensed -PNB" },
      { text: "A/c XX6731 debited with Rs.23.60, 04-11-2026 18:01:33 thru card XX5108 for balance enquiry charges at non-PNB ATM -PNB", ok: "expense", noAtm: true },
      { text: "Ac XX9921 Credited with Rs.5,415.00 04-11-2026 towards Loan EMI. -PNB" },
      { text: "Ac XX6731 Debited with Rs.8,615.00, 04-11-2026 towards your Credit Card XX7146 bill payment -PNB" },
      { text: "Ac XX6731 Credited with Rs.1,845.00, 04-11-2026 09:12:47. Aval Bal Rs.12,630.25 DR. -PNB", ok: "income" },
    ],
  },
  bob: {
    sender: "AD-BOBTXN-S",
    cases: [
      { text: "Rs.545.00 debited from A/c XX7193 on 08-11-26 to SURYA STORES. Avl Bal Rs.9,247.40 Cr. -Bank of Baroda", ok: "expense" },
      { text: "Rs.2,655.00 Credited to A/c XX558812 on 01-11-2026. AvlBal:Rs 7,786.10 Dr. -Bank of Baroda", ok: "income" },
      { text: "Rs.12,450.00 credited to your BOBCARD ending 3381 on 04-11-2026. -Bank of Baroda" },
      { text: "Payment of Rs 12,450.00 received towards your BOBCARD ending 3381 on 04-11-2026. -BOBCARD" },
      { text: "Rs.5,015.00 Cr. to Loan A/c XX991177 from A/c XX558812 on 04-11-2026. Ref:631955120223 -Bank of Baroda" },
      { text: "Rs.1,415.00 Cr. to A/c XX558812 by refund from ZIPMART, will be credited in 3 days -BOB" },
    ],
  },
  union: {
    sender: "JM-UNIONB-S",
    cases: [
      { text: "Union Bank of India A/c*5093 Dr Rs12,015.00 on 04-11-26 13:43 by MB 6601234567 towards credit card XX4410 payment, Bal Rs3,105.80" },
      { text: "Union Bank of India A/c*5093 Dr Rs214.00 on 04-11-26 13:43 by MB 6601234567 NAVKAR MEDICALS reversed, Bal Rs3,105.80" },
      { text: "Union Bank of India A/c*5093 Cr Rs5,415.00 on 04-11-26 towards Loan EMI, Bal Rs4,285.80" },
    ],
  },
  boi: {
    sender: "BZ-BOIIND-S",
    cases: [
      { text: "Rs.418.00 debited A/cXX2846 and credited to PRAKASH DAIRY via UPI Ref No 631922334455 on 04Nov26 has been reversed. -BOI" },
      { text: "Rs.8,615.00 debited A/cXX2846 and credited to towards your Credit Card XX7146 bill payment via UPI Ref No 631922330002 on 04Nov26 -BOI" },
      { text: "BOI - Rs 5,415.00 Credited in your Ac XX9917 on 04-11-2026 towards Loan EMI .Avl Bal 0.00" },
    ],
  },
  central: {
    sender: "CP-CENTBK-S",
    cases: [
      { text: "Rs. 1,265.00 credited to your A/c xxxxxx7719 on 04/11/2026 through UPI vide Ref No. 631933445572 By.REFUND PIXELSHOP will be credited in 5 days-CBoI" },
      { text: "Rs. 8,615.00 debited from your A/c xxxxxx7719 on 04/11/2026 through UPI towards your Credit Card XX7146 bill payment-CBoI" },
      { text: "Rs. 5,415.00 credited to your A/c xxxxxx9917 on 04/11/2026 through NEFT towards Loan EMI-CBoI" },
    ],
  },
  indian: {
    sender: "AD-INDBNK-S",
    cases: [
      { text: "Rs.5,415.00 credited to a/c *9910 on 04/11/2026 towards your loan account EMI.Indian Bank" },
      { text: "Sent Rs.8,615.00 from A/c *6614 on 04-11-26 to towards your Credit Card XX7146 bill payment.RRN 631944550002" },
      { text: "Sent Rs.615.00 from A/c *6614 on 04-11-26 to KAVERI MESS.RRN 631944556789 has been reversed.-Indian Bank" },
    ],
  },
  iob: {
    sender: "VM-IOBCHN-S",
    cases: [
      { text: "Rs.610.00 debited from your a/c XXXXX4417 on 04-11-26 has been reversed. -IOB" },
      { text: "Your a/c no. XXXXX9917 is credited by Rs.5,415.00 on 04-11-26 towards Loan EMI. -IOB" },
    ],
  },
  uco: {
    sender: "VK-UCOBNK-S",
    cases: [
      { text: "A/c XX9910 Credited with Rs.5,415.00 on 04-11-2026 by transfer towards Loan A/c EMI.Avl Bal Rs.0.00" },
      { text: "A/c XX8840 Debited with Rs.12,015.00 on 04-11-2026 by UCO-UPI towards UCO Credit Card XX4410.Avl Bal Rs.6,322.90" },
      { text: "A/c XX8840 Debited with Rs.475.00 on 04-11-2026 by UCO-UPI reversed.Avl Bal Rs.6,322.90" },
    ],
  },
  psb: {
    sender: "JD-PSBANK-S",
    cases: [
      { text: "PSB000000781934527 Loan A/c No **9917 Credited with Rs 5415--Trf from SB **7326 (CLR BAL 115000.00DR)(04-11-2026 10:41:22) Punjab&Sind Bank" },
      { text: "PSB000000781934528 A/c No **7326 Debited with Rs 8,615.00--towards your Credit Card XX7146 bill payment (CLR BAL 100.00CR)(04-11-2026)" },
      { text: "PSB000000781934529 A/c No **7326 Debited with Rs 655--UPI/DR/631955667792/GROCERY NOOK/YESB/U REVERSED (CLR BAL 7130.25CR)(04-11-2026)-Punjab&Sind Bank" },
    ],
  },
};

describe.each(Object.entries(OWN))("%s: tricky messages in the bank's own shapes", (id, { sender, cases }) => {
  it.each(cases)("$text", ({ text, ok, noAtm }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type, `${id} booked ${p.type}`).toBe(ok);
    if (booked(p)) expect(ok, `${id} booked a message that must go to Review`).toBeDefined();
    if (noAtm && p.kind === "money") expect(p.atm).toBeUndefined();
    // A loan account's digits are never booked as the person's.
    if (p.kind === "money" && /\bloan\b/i.test(text)) expect(["9917", "9910", "9921", "6610", "1177"]).not.toContain(p.last4);
  });
});

// Ticket 171 review, round 2: the guards above must not cost good messages their booking or their payee. Words like
// "loan", "EMI", "refund" or "REV" inside a payee's name, a promo line or a help line change nothing.
const GOOD: { sender: string; text: string; type: "income" | "expense"; merchant?: string; atm?: true }[] = [
  { sender: "VM-CANBNK-S", text: "Dear Customer, Acct XXX482 Dr. INR 342.60 on 05/11/26 to REVERSAL ARCADE STUDIO; UPI: 631702491001; Bal INR 7,872.06-CanaraBank", type: "expense", merchant: "REVERSAL ARCADE STUDIO" },
  { sender: "VM-CANBNK-S", text: "Dear Customer, Acct XXX482 Dr. INR 342.60 on 05/11/26 to REV AUTOWORKS; UPI: 631702491002; Bal INR 7,872.06-CanaraBank", type: "expense", merchant: "REV AUTOWORKS" },
  { sender: "VM-CANBNK-S", text: "An amount of INR 9,125.00 has been debited from XXXX3917 on 05/11/2026 towards RTGS to Beneficiary JOSHI LOAN TRADERS, IFSC SBIN0004321, Beneficiary A/c XXXX7781 - Canara Bank", type: "expense", merchant: "JOSHI LOAN TRADERS" },
  { sender: "VM-CANBNK-S", text: "An amount of INR 2,145.00 has been credited to XXXX3917 on 05/11/2026 towards NEFT by Sender LOAN LEAF FOODS, IFSC HDFC0001234, Sender A/c XXXX5521 - Canara Bank", type: "income", merchant: "LOAN LEAF FOODS" },
  { sender: "VM-PNBSMS-S", text: "A/c X6731 debited INR 1,965.00 Dt 05-11-26 08:40:12 to EMI MART thru UPI:631845001101.Bal INR 10,569.25-PNB", type: "expense", merchant: "EMI MART" },
  { sender: "VM-PNBSMS-S", text: "Ac XX6731 Credited with Rs.86,400.00 05-11-2026 11:02:09 being Salary Nov. Aval Bal Rs.96,969.25 CR. Apply for a Home Loan at 8.4% -PNB", type: "income" },
  { sender: "VM-PNBSMS-S", text: "Ac XX6731 Debited with Rs.1,870.00, 05-11-2026 09:12:47. Aval Bal Rs.95,099.25 CR. For refunds or disputes call 18001234-PNB", type: "expense" },
  { sender: "VM-PNBSMS-S", text: "A/c XX6731 debited with Rs.4,150.00, 05-11-2026 18:01:33 thru card XX5108 at PNB ATM. Bal 90,949.25 CR. Cash not dispensed? Call 18001234 -PNB", type: "expense", atm: true },
  { sender: "VM-PNBSMS-S", text: "A/c XX6731 debited with Rs.4,150.00, 05-11-2026 18:01:33 thru card XX5108 . Out of 5 free txn on PNB ATM, you have used 2. Bal 86,799.25 CR -PNB", type: "expense", atm: true },
  { sender: "VM-PNBSMS-S", text: "A/c XX6731 debited with Rs.4,150.00, 05-11-2026 18:01:33 thru card XX5108 at SBI ATM. Charges apply beyond 5 free txns. -PNB", type: "expense", atm: true },
  { sender: "AD-BOBCRD-S", text: "ALERT: INR 2,345.75 is spent on your BOBCARD ending 3381 at CROMA ONLINE on 05-11-2026. Make your BOBCARD payment on time to avoid charges. -Bank of Baroda", type: "expense", merchant: "CROMA ONLINE" },
  { sender: "AD-BOBCRD-S", text: "ALERT: INR 2,345.75 is spent on your BOBCARD ending 3381 at BOBCARD LOUNGE CAFE on 05-11-2026. -Bank of Baroda", type: "expense", merchant: "BOBCARD LOUNGE CAFE" },
  { sender: "AD-BOBCRD-S", text: "ALERT: INR 655.00 is credited to your BOBCARD ending 3381 as refund from SHOPKART on 05-11-2026. -Bank of Baroda", type: "income", merchant: "SHOPKART" },
  { sender: "AD-BOBSMS-S", text: "Rs.326.00 Dr. from A/c XX719628 to:BOBCARD STATIONERS. Ref:631902111001 -Bank of Baroda", type: "expense", merchant: "BOBCARD STATIONERS" },
  { sender: "AD-BOBSMS-S", text: "Rs.86,400.00 Cr. to A/c XX719628 on 05-11-2026 Salary from ACME LOANS PVT LTD. AvlBal:Rs96,400.00 -Bank of Baroda", type: "income" },
  { sender: "BZ-BOIIND-S", text: "Rs.426.00 debited A/cXX2846 and credited to REVATHI STORES via UPI Ref No 631922331101 on 05Nov26. -BOI", type: "expense", merchant: "REVATHI STORES" },
  { sender: "BZ-BOIIND-S", text: "Rs.426.00 debited A/cXX2846 and credited to SHOP 247365 via UPI Ref No 631922331102 on 05Nov26. -BOI", type: "expense", merchant: "SHOP 247365" },
  { sender: "AD-INDBNK-S", text: "Sent Rs.624.00 from A/c *6614 on 05-11-26 to Towards Travels.RRN 631944551101.-Indian Bank", type: "expense", merchant: "Towards Travels" },
  { sender: "AD-INDBNK-S", text: "Sent Rs.624.00 from A/c *6614 on 05-11-26 to Refund Kart.RRN 631944551102.-Indian Bank", type: "expense", merchant: "Refund Kart" },
  { sender: "AD-INDBNK-S", text: "Rs. 18,725 credited to A/c XX6614 on 05/11/2026 UTR:SBIN0631955/NEFT/SENDER ENTERPRISES / -Indian Bank", type: "income", merchant: "SENDER ENTERPRISES" },
  { sender: "CP-CENTBK-S", text: "Rs. 547.00 debited from your A/c xxxxxx7719 on 05/11/2026 through UPI vide Ref No. 631933441101 To.REFUND DESK OF KART-CBoI", type: "expense", merchant: "REFUND DESK OF KART" },
  { sender: "CP-CENTBK-S", text: "Rs. 1,655.00 credited to your A/c xxxxxx7719 on 05/11/2026 through NEFT vide Ref No./N308261101 By.EMI FINANCE LTD-CBoI", type: "income", merchant: "EMI FINANCE LTD" },
  { sender: "VK-UCOBNK-S", text: "A/c XX8840 Credited with Rs.5,445.00 on 05-11-2026 by NEFT from EMIRATES TRADING.Avl Bal Rs.8,367.90", type: "income", merchant: "EMIRATES TRADING" },
  { sender: "JD-PSBANK-S", text: "PSB000000781934540 A/c No **7326 Credited with Rs 662--UPI/CR/631955661101/LOANWALA SERVICES/SBIN/U (CLR BAL 7246.75CR)(05-11-2026)-Punjab&Sind Bank", type: "income", merchant: "LOANWALA SERVICES" },
  { sender: "JM-UNIONB-S", text: "Union Bank of India A/c*5093 Cr Rs1,195.00 on 05-11-26 10:07 by MB 6601234679 EMI HUB, Bal Rs4,300.80", type: "income", merchant: "EMI HUB" },
  { sender: "VM-IOBCHN-S", text: "Your a/c no. XXXXX4417 is debited for Rs.872.00 on 05-11-26 towards REVERSE OSMOSIS SERVICE by UPI ref 631966771101. -IOB", type: "expense" },
];

describe("good messages keep their booking and their payee", () => {
  it.each(GOOD)("$sender $text", ({ sender, text, type, merchant, atm }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p).toMatchObject({ kind: "money", type });
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
    if (merchant) expect(p.kind === "money" && p.merchant).toBe(merchant);
    if (atm) expect(p.kind === "money" && p.atm).toBe(true);
    else expect(p.kind === "money" && p.atm).toBeFalsy();
  });

  it("a shop called ATM STORES is not cash, and a disbursal reason is not a payee", () => {
    const shop = parseCapture("A/c XX6731 debited with Rs.1,215.00, 05-11-2026 thru card XX5108 at ATM STORES LAJPAT NAGAR -PNB", RECEIVED, { sender: "VM-PNBSMS-S" });
    expect(shop.kind === "money" && shop.atm).toBeFalsy();
    const loan = parseCapture("Dear Customer, Acct XXX482 credited with INR 52,500.00 on 05-11-26 from Personal Loan disbursal; Bal INR 60,372.06-CanaraBank", RECEIVED, { sender: "VM-CANBNK-S" });
    expect(loan).toMatchObject({ kind: "money", type: "income", merchant: undefined });
    const phoneVpa = parseCapture("Sent Rs.624.00 from A/c *6614 on 05-11-26 to 98123456789@ybl.RRN 631944551103.-Indian Bank", RECEIVED, { sender: "AD-INDBNK-S" });
    expect(phoneVpa.kind === "money" && phoneVpa.merchant).toBeUndefined();
  });
});

// Ticket 171 review, round 3: repayments worded "for/as/against … loan/EMI" or "EMI recovery" stay in Review without the
// loan's digits (or become the named account's expense); card bill payments carry no merchant; a charge on the card
// line is never cash from an ATM.
describe("round 3: loan wording, card payments and ATM charges", () => {
  it.each([
    { sender: "AD-BOBSMS-S", text: "Rs.5,415.00 Cr. to A/c XX991177 on 05-11-2026 for Loan EMI Dec. Ref:631902111010 -Bank of Baroda" },
    { sender: "VK-UCOBNK-S", text: "A/c XX9910 Credited with Rs.5,415.00 on 05-11-2026 by EMI recovery.Avl Bal Rs.0.00" },
    { sender: "VK-UCOBNK-S", text: "A/c XX9910 Credited with Rs.5,415.00 on 05-11-2026 by transfer. Adjusted against your home loan dues.Avl Bal Rs.0.00" },
    { sender: "AD-INDBNK-S", text: "Rs.5,415.00 credited to a/c *9910 on 05/11/2026 as EMI.Indian Bank" },
    { sender: "VM-PNBSMS-S", text: "Ac XX9921 Credited with Rs.5,415.00 05-11-2026 by transfer. This amount is towards loan instalment for Dec. -PNB" },
  ])("$sender: a repayment into a loan stays in Review with no digits or payee", ({ sender, text }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    if (p.kind === "money") {
      expect(p.last4).toBeUndefined();
      expect(p.merchant).toBeUndefined();
    }
  });

  it("a repayment naming the account it left is that account's expense, in Review", () => {
    const p = parseCapture("Union Bank of India A/c*7720 Cr Rs5,415.00 on 05-11-26 10:07 for EMI from A/c *5093, Bal Rs0.00", RECEIVED, { sender: "JM-UNIONB-S" });
    expect(p).toMatchObject({ kind: "money", type: "expense", last4: "5093" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it.each([
    "Rs.12,450.00 transferred from A/c ...7193 to:BOBCARD ending 3381 on 05-11-2026. Total Bal:Rs.9,247.40CR. -Bank of Baroda",
    "Your BOBCARD ending 3381 payment of Rs 12,450.00 has been received. Refund of excess payment processed. -BOBCARD",
  ])("a BOBCARD bill payment is a card payment with no merchant: %s", (text) => {
    const p = parseCapture(text, RECEIVED, { sender: "AD-BOBSMS-S" });
    expect(p).toMatchObject({ kind: "money", cardPayment: true, last4: "3381", merchant: undefined });
    expect(p.confidence).toBeLessThanOrEqual(0.5);
  });

  it("a disbursal reason is never Bank of Baroda's payee", () => {
    const p = parseCapture("Rs.2,05,000.00 credited to A/c XX719628 via NEFT/631902111011 by Personal Loan disbursal. AvlBal:Rs2,15,000.00 -Bank of Baroda", RECEIVED, { sender: "AD-BOBSMS-S" });
    expect(p).toMatchObject({ kind: "money", type: "income", merchant: undefined });
  });

  it("a charge named on the card line is never cash from an ATM", () => {
    const p = parseCapture("A/c XX6731 debited with Rs.23.60, 05-11-2026 thru card XX5108 towards ATM charges. Txn at SBI ATM -PNB", RECEIVED, { sender: "VM-PNBSMS-S" });
    expect(p.kind === "money" && p.atm).toBeFalsy();
  });

  it("a credit 'by transfer' names no payee", () => {
    const p = parseCapture("A/c XX8840 Credited with Rs.1,935.00 on 05-11-2026 by transfer.Avl Bal Rs.8,257.90", RECEIVED, { sender: "VK-UCOBNK-S" });
    expect(p).toMatchObject({ kind: "money", type: "income", merchant: undefined });
  });
});
