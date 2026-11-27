import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 175: the phase 8 safety rules, for every app parser. Invented messages only.
const APPS = [
  { id: "phonepe_wallet", sender: "JD-PHONPE-S", name: "PhonePe" },
  { id: "jupiter", sender: "VK-JTEDGE-S", name: "Jupiter" },
  { id: "slice", sender: "AD-SLCEIT-S", name: "slice" },
  { id: "onecard", sender: "CP-ONECRD-S", name: "OneCard" },
  { id: "cred", sender: "JK-CREDIN-S", name: "CRED" },
  { id: "lazypay", sender: "BP-LZYPAY-S", name: "LazyPay" },
  { id: "juspay", sender: "JM-JUSPAY-S", name: "Amazon Pay" },
  { id: "cashfree", sender: "JX-CSHFRE-S", name: "Cashfree" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;

/** Messages that move no money yet, or move it between the person's own accounts. `ok` is the only type that may
 * be booked without Review; left out, nothing may be. */
function tricky(app: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.3,815.00 done at CDM in A/c X7731 on 04Nov26. -${app}`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.355.00 initiated to your ${app} card 7731 by PANTRYCO on 2026-11-03. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.618 on ${app} card 7731 at GADGETCO On 2026-11-03 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${app} Credit Card 7731 payment of Rs.6,240.00 has been received on 04-11-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 4,415.00 from A/c ****7731 to ${app} Credit Card XX2268 via NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX7731 debited for Rs 7,705.00 on 04-Nov-26; ${app} Credit Card XX5184 credited. UPI:731100441122.` },
    { name: "credit card bill debit", text: `INR 8,120.00 debited from A/c no. XX663107 on CREDIT CARD BILL PAYMENT 04-11-2026 09:41:08 IST. - ${app}` },
    { name: "mandate set-up", text: `${app} Acct XX7731 credited Rs 2.65 on 04-Nov-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 287.00 from A/c XX7731 to PANTRYCO has failed. -${app}` },
    { name: "OTP", text: `318654 is your OTP for a payment of Rs 842.00 at GADGETCO. Do not share. -${app}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 169.00 will be debited from A/c XX7731 on 06-11-26 for TuneCo. -${app}` },
    { name: "wallet top-up", text: `Rs.500 has been added to your ${app} wallet on 04-11-26.` },
    { name: "pay-later repayment", text: `Repayment of Rs. 2,610.00 towards your ${app} dues received. Thank you.` },
  ];
}

describe.each(APPS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    // Messages an app parser does not claim go to the generic parser and read exactly as with no sender.
    if (p.parserId !== id) {
      expect(p).toEqual(generic(text, RECEIVED, {}));
      return;
    }
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    // A plain message in none of the app's shapes. App parsers either hand it to the generic parser or, for a
    // pay-later line that has no account, read it without the account; never higher than the generic parser.
    const text = "Rs.230.00 debited from A/c XX7731 to VPA stall.two@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    const plain = generic(text, RECEIVED, { sender });
    expect(own.confidence).toBeLessThanOrEqual(plain.confidence);
    if (own.kind === "money" && own.parserId === id) expect(own.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE + 0.2);
  });

  it("never takes the payee's or a loan's account as the person's", () => {
    const twoAccounts = "Your a/c no. XXXXXXXX7305 is debited for Rs.415.00 on 04-11-26 and a/c XXXXXX8842 credited (IMPS Ref no 731100553311).";
    const loan = "Your loan account XX6618 is credited with Rs 2,215.00 by debit to A/c XX7305 on 04-11-26.";
    const a = parseCapture(twoAccounts, RECEIVED, { sender });
    const b = parseCapture(loan, RECEIVED, { sender });
    if (a.kind === "money") expect(a.last4).not.toBe("8842");
    if (b.kind === "money") expect(b.last4).not.toBe("6618");
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `You've paid Rs.48.70 via PhonePe wallet for ${"A ".repeat(2500)}`,
      `Rs.63.45 debited to your Edge CSB Bank RuPay Credit Card ending 4417 ${" ".repeat(5000)}x`,
      `Sent Rs.85 to ${"MEENA ".repeat(800)} (UPI`,
      `You've made a transaction of Rs. 412.00 on ${"BOOK ".repeat(1000)}on card ending`,
      `Payment of Rs.8,465 has been successfully credited towards your ${"ICICI ".repeat(800)}Credit Card`,
      `Your txn TXN5812640 of Rs. 236.40 on ${"QUICK ".repeat(800)}was`,
      `Payment of Rs 366.85 using Apay Balance successful at ${"CLOUD ".repeat(800)}`,
      `Payment INR 452.70 (ID:8812203344) confirmed for order #${"o".repeat(60)} on ${"Lantern ".repeat(600)}`,
      `Repayment of Rs.2,315 received for the slice credit card ${"Rs.1 ".repeat(900)}`,
    ];
    for (const text of pads) {
      const start = performance.now();
      parseCapture(text, RECEIVED, { sender });
      expect(performance.now() - start).toBeLessThan(250);
    }
  });
});
