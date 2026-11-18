import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, parseCapture, type CaptureParse } from "@/lib/capture/parsers";

// Made-up messages in the shape real banks send (no real numbers), one per message type. Ticket 150: these came
// out of a comparison with another open parser; each marks a case ours got wrong or must keep getting right.
const RECEIVED = new Date("2026-11-12T06:30:00Z"); // 12:00 IST, 12 Nov 2026

const money = (p: CaptureParse) => {
  expect(p.kind).toBe("money");
  if (p.kind !== "money") throw new Error("not money");
  return p;
};

describe("parseCapture: message types", () => {
  it("keeps a debit that ends with the usual fraud warning (never share OTP)", () => {
    const p = money(
      parseCapture(
        "Rs.640.00 debited from A/c XX4821 on 12-11-26 to VPA blinkit@ybl. UPI Ref 631233445566. Never share OTP/PIN with anyone. -HDFC Bank",
        RECEIVED
      )
    );
    expect(p).toMatchObject({ type: "expense", amountMinor: 64000, last4: "4821", merchant: "blinkit@ybl" });
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });

  it("keeps the phone's own two warning shapes (CaptureFilterTest)", () => {
    for (const warning of ["Do not share your OTP with anyone.", "Bank never asks for OTP."]) {
      const p = parseCapture(`Rs 250.00 debited from A/c XX1234 on 12-11-26 to VPA swiggy@icici. ${warning}`, RECEIVED);
      expect(p.kind).toBe("money");
    }
  });

  it("still ignores a real OTP", () => {
    const p = parseCapture(
      "482913 is the OTP for transaction of INR 2,499.00 on your HDFC Bank Card ending 4821 at FLIPKART. Valid for 5 mins. Do not share OTP with anyone.",
      RECEIVED
    );
    expect(p).toMatchObject({ kind: "ignored", reason: "otp" });
  });

  it("reads a spend abroad in its own currency, never the card limit, and sends it to review", () => {
    const p = money(
      parseCapture(
        "USD 12.99 spent on your HDFC Bank Credit Card ending 2210 at NETFLIX.COM on 12-11-26 at 09:14:22. Avl Lmt INR 1,02,340.00",
        RECEIVED
      )
    );
    expect(p).toMatchObject({ type: "expense", amountMinor: 1299, currency: "USD", last4: "2210", merchant: "NETFLIX.COM" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("skips an 'Avl Lmt' figure that comes first", () => {
    const p = money(parseCapture("Avl Lmt INR 50,000.00. Rs 120.00 spent on Card XX1234 at CAFE on 12-11-26", RECEIVED));
    expect(p.amountMinor).toBe(12000);
  });

  it("marks a credit card bill payment, never as spending, and never auto-creates it", () => {
    const p = money(
      parseCapture("Payment of Rs 25,000.00 received towards your ICICI Bank Credit Card XX7731 on 12-Nov-26. Thank you.", RECEIVED)
    );
    expect(p).toMatchObject({ type: "income", amountMinor: 2500000, cardPayment: true, instrument: "card", last4: "7731" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("reads SBI 'has a debit by transfer ... ATM WDL' as an ATM withdrawal", () => {
    const p = money(
      parseCapture(
        "Dear Customer, Your A/C XXXXX5512 has a debit by transfer of Rs 5,000.00 on 12/11/26 ATM WDL. Avl Bal Rs 23,450.10.-SBI",
        RECEIVED
      )
    );
    expect(p).toMatchObject({ type: "expense", amountMinor: 500000, last4: "5512", atm: true });
  });

  it("reads the short Dr and Cr forms", () => {
    const dr = money(parseCapture("A/c XX4821 Dr Rs 2,500.00 on 12-11-26 Info: BIL*ONL*ELECTRICITY. Bal Rs 15,730.45", RECEIVED));
    expect(dr).toMatchObject({ type: "expense", amountMinor: 250000, last4: "4821" });
    const cr = money(parseCapture("A/c XX4821 Cr Rs 1,000.00 on 12-11-26 by NEFT from ACME LTD. Bal Rs 16,730.45", RECEIVED));
    expect(cr).toMatchObject({ type: "income", amountMinor: 100000 });
  });

  it("does not read 'debit card' as a debit: a refund to a debit card is a credit", () => {
    const p = money(parseCapture("Your Debit Card XX1234 has been credited with a refund of Rs 499.00 on 12-11-26", RECEIVED));
    expect(p.type).toBe("income");
  });

  it("ignores a payment that failed, but keeps money that came back", () => {
    expect(
      parseCapture("Your UPI transaction of Rs 300.00 to blinkit@ybl has failed. Amount if debited will be refunded within 48 hrs.", RECEIVED)
    ).toMatchObject({ kind: "ignored", reason: "not_financial" });
    const back = money(parseCapture("Rs 799.00 reversed to your Axis Bank A/c XX3301 on 12-11-26 for failed UPI txn Ref 631277665544", RECEIVED));
    expect(back).toMatchObject({ type: "income", amountMinor: 79900, last4: "3301" });
  });

  it("never takes a phone number as the merchant", () => {
    const p = money(
      parseCapture(
        "INR 3,499.00 spent using ICICI Bank Card XX7731 on 12-Nov-26 on AMAZON PAY IN. Avl Limit: INR 1,46,501.00. If not you, call 1800 2662/SMS BLOCK 7731 to 9215676766",
        RECEIVED
      )
    );
    expect(p.merchant ?? "").not.toMatch(/^\d/);
  });

  it("keeps a whole VPA with a dot as the payer", () => {
    const p = money(
      parseCapture("Received Rs.2,000.00 in your Kotak Bank a/c XX9087 from rahul.k@okaxis on 12-11-26.UPI Ref:631211223344.", RECEIVED)
    );
    expect(p).toMatchObject({ type: "income", amountMinor: 200000, merchant: "rahul.k@okaxis" });
  });

  it("drops a 'has been credited' tail from the merchant", () => {
    const p = money(
      parseCapture("Refund of Rs.1,299.00 for your ICICI Bank Credit Card XX7731 transaction at MYNTRA has been credited on 12-Nov-26.", RECEIVED)
    );
    expect(p).toMatchObject({ type: "income", merchant: "MYNTRA" });
  });

  it("takes the account the EMI left, not the loan account", () => {
    const p = money(parseCapture("EMI of Rs 4,512.00 for loan a/c XXXX6789 has been debited from your A/c XX4821 on 05-11-26. -HDFC Bank", RECEIVED));
    expect(p).toMatchObject({ type: "expense", amountMinor: 451200, last4: "4821" });
  });

  it.each([
    ["Sent Rs.1,250.50 From HDFC Bank A/C *4821 To ZOMATO LIMITED On 12/11/26 Ref 631298765432 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808", "expense", 125050],
    ["Dear UPI user A/C X5512 debited by 420.0 on date 12Nov26 trf to SWIGGY Refno 631245678901. If not u? call 1800111109. -SBI", "expense", 42000],
    ["Your A/c XX9087 is credited with INR 85,000.00 on 30-Oct-26 by NEFT from ACME TECHNOLOGIES PVT LTD. Avl Bal INR 1,02,345.67 - Kotak Bank", "income", 8500000],
    ["Thanks for using HDFC Bank Card XX4821 for Rs. 3000.00 at ATM CHENNAI on 2026-11-12:14:02:11 for Cash Withdrawal. Avl bal: Rs 15,230.45", "expense", 300000],
    ["₹1,045 debited from a/c **3301 at RELIANCE SMART on 12 Nov 2026. Bal ₹9,120.40", "expense", 104500],
  ])("still reads %s", (text, type, amount) => {
    expect(money(parseCapture(text, RECEIVED))).toMatchObject({ type, amountMinor: amount, currency: "INR" });
  });

  it.each([
    ["Congratulations! You are eligible for a pre-approved Personal Loan of Rs 5,00,000 at 10.5% p.a. Apply now: hdfc.bank.in/xyz T&C"],
    ["Your ICICI Bank Credit Card XX7731 statement: Total Amt Due Rs 32,450.00, Min Amt Due Rs 1,623.00, Due Date 02-Dec-26."],
    ["ZOMATO has requested money Rs 450 from you on UPI. Pay now"],
  ])("never books %s", (text) => {
    expect(parseCapture(text, RECEIVED).kind).toBe("ignored");
  });

  // Review of ticket 150: each of these went wrong in a first draft of the fixes.
  it.each([
    ["Your e-mandate debit of Rs 499 for Netflix is scheduled on 28-09-26 from A/c XX1234"],
    ["Auto debit of Rs 2,500 towards LIC premium will be processed on 01-10-26 from your A/c XX1234"],
    ["Upcoming debit: Rs 999 for your SIP from A/c XX1234 on 15-11-26"],
    ["Insufficient balance for debit of Rs 1,000 in A/c XX1234 on 12-11-26"],
  ])("never books a notice before a debit: %s", (text) => {
    expect(parseCapture(text, RECEIVED).kind).toBe("ignored");
  });

  it.each([
    ["Don't share this OTP 123456 for txn of Rs 500 at AMAZON on card XX4321 on 26-09-26 with anyone"],
    ["Do not share OTP 482910 for Rs 1,500 txn at FLIPKART"],
  ])("still ignores an OTP inside a 'do not share' sentence: %s", (text) => {
    expect(parseCapture(text, RECEIVED)).toMatchObject({ kind: "ignored", reason: "otp" });
  });

  it.each([
    ["Rs 450 spent on card XX4321 at AMAZON.Avl Lmt Rs 50,000", "AMAZON"],
    ["Rs 120.00 debited from A/c XX1234 on 12-11-26 to VPA swiggy@ybl.Avl Bal Rs 2000", "swiggy@ybl"],
    ["Rs 300 spent on card XX4321 at ZOMATO.Ref 12345", "ZOMATO"],
  ])("ends the merchant at a dot glued to the next field: %s", (text, merchant) => {
    expect(money(parseCapture(text, RECEIVED)).merchant).toBe(merchant);
  });

  it("keeps the payer's account when a debit also names the account credited", () => {
    const p = money(
      parseCapture("Your a/c no XX1234 is debited for Rs 500 on 26-09-26 and credited to a/c XX5678 (UPI Ref 631200000001)", RECEIVED)
    );
    expect(p).toMatchObject({ type: "expense", last4: "1234" });
  });

  it.each([
    ["Rs 500 debited from A/c XX1234 on 26-09-26 to VPA shop@ybl. UPI txn failed? Call 18001234"],
    ["Rs 500 debited from A/c XX1234 on 26-09-26 towards insurance premium. Your previous request has been rejected."],
    ["Rs 99 spent on Card XX4321 at Spotify on 12-11-26. Card has been declined earlier? Ignore."],
  ])("keeps a real debit that mentions a failure elsewhere: %s", (text) => {
    expect(money(parseCapture(text, RECEIVED)).type).toBe("expense");
  });

  it.each([
    ["We have received payment of Rs.15,000.00 towards your Credit Card XX4321 on 12-11-26.", "4321"],
    ["Rs 15,000 credited to your credit card XX4321 on 12-11-26.", "4321"],
    ["Thank you for the payment of Rs 15,000.00 towards your SBI Card ending 4321.", "4321"],
    ["Payment of Rs 5,000 to HDFC Credit Card XX9999 via UPI from A/c XX1234 received towards credit card.", "9999"],
  ])("marks each shape of card bill payment: %s", (text, last4) => {
    const p = money(parseCapture(text, RECEIVED));
    expect(p).toMatchObject({ cardPayment: true, instrument: "card", last4 });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("uses the rupee figure when a spend abroad also states what was billed", () => {
    const p = money(parseCapture("You spent $25.00 at STEAM with card XX4321 on 12-11-26 (INR 2,150.00)", RECEIVED));
    expect(p).toMatchObject({ currency: "INR", amountMinor: 215000 });
  });

  // Second review of ticket 150.
  it.each([
    ["Rs 500 spent on card XX4321 at AMAZON on 26-09-26. Auth code 123456"],
    ["INR 1,200.00 spent on ICICI Bank Card XX4321 at FLIPKART on 12-11-26. Approval code: 874512"],
    ["Rs 500 debited from A/c XX1234 on 12-11-26 using promo code 2026 at SWIGGY"],
    ["Rs 120.00 debited from A/c XX1234 on 12-11-26. Avl Bal Rs 5000. Never share OTP with anyone"],
  ])("books a card spend or debit that carries an auth code or a closing warning: %s", (text) => {
    expect(money(parseCapture(text, RECEIVED)).type).toBe("expense");
  });

  it.each([
    ["Sent Rs.100.00 From HDFC Bank A/C *1234 To Ravi On 26/09/26 Ref 123456. SIP scheduled tomorrow"],
    ["Rs 5,000 sent to Rahul from A/c XX1234 on 26-09-26. Upcoming: bill due"],
  ])("books a sent payment whose footer mentions what is coming: %s", (text) => {
    expect(money(parseCapture(text, RECEIVED)).type).toBe("expense");
  });

  it.each([
    ["Refund of Rs 1,299 from MYNTRA has been credited to your credit card XX7731 on 12-11-26", "income"],
    ["Cashback of Rs 50 credited to your credit card XX7731 on 12-11-26", "income"],
    ["Thank you for your payment of Rs 799 to Airtel using credit card XX4321 on 12-11-26", "expense"],
  ])("does not take money back or a spend with a card for a bill payment: %s", (text, type) => {
    const p = money(parseCapture(text, RECEIVED));
    expect(p.cardPayment).toBeUndefined();
    expect(p.type).toBe(type);
  });

  it.each([
    ["Rs 450 paid at DMART on 12-11-26.Thanks for shopping", "DMART"],
    ["Rs 99 debited at Cafe Coffee on 12-11-26 from A/c XX1234.Dear customer, call us", "Cafe Coffee"],
  ])("ends the merchant before a glued greeting: %s", (text, merchant) => {
    expect(money(parseCapture(text, RECEIVED)).merchant).toBe(merchant);
  });

  it("ignores a failed payment that says 'if amount is debited it will be refunded'", () => {
    expect(
      parseCapture("UPI payment of Rs 300 to blinkit@ybl failed. If amount is debited it will be refunded in 48 hrs.", RECEIVED)
    ).toMatchObject({ kind: "ignored" });
  });

  it.each([
    ["Rs 499 will be debited from your A/c XX1234 on 28-09-26 towards Netflix e-mandate"],
    ["Pre-debit alert: Rs 2,500 is scheduled to be debited from A/c XX1234 on 01-10-26 for LIC"],
    ["Your SI request has been received. Rs 2,000 will be debited from A/c XX1234 on 05-12-26"],
  ])("never books a debit that is still to come: %s", (text) => {
    expect(parseCapture(text, RECEIVED).kind).toBe("ignored");
  });

  it.each([
    ["Pre-debit notification: Rs 499 will be debited from A/c XX1234 on 28-09-26 towards Netflix mandate received on 01-01-26"],
    ["Refund of Rs 499 to be credited to your A/c XX1234 in 5 days"],
    ["Rs 499 will be credited to your A/c XX1234 as refund within 7 days"],
  ])("never books money that has not moved yet: %s", (text) => {
    expect(parseCapture(text, RECEIVED).kind).toBe("ignored");
  });
});

