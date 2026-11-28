import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 172: the rules every bank parser keeps (from the ticket 155 to 157 reviews), run for each private bank.
// Invented messages only.
const BANKS = [
  { id: "federal", sender: "VM-FEDBNK-S", name: "Federal Bank" },
  { id: "idbi", sender: "AD-IDBIBK-S", name: "IDBI Bank" },
  { id: "yes", sender: "VM-YESBNK-S", name: "YES BANK" },
  { id: "indusind", sender: "VM-INDUSB-S", name: "IndusInd Bank" },
  { id: "south_indian", sender: "AD-SIBSMS-S", name: "South Indian Bank" },
  { id: "karnataka", sender: "VM-KBLBNK-S", name: "Karnataka Bank" },
  { id: "city_union", sender: "VM-CUBANK-S", name: "City Union Bank" },
  { id: "tmb", sender: "VM-TMBANK-S", name: "TMB" },
  { id: "dhanlaxmi", sender: "VM-DHANBK-S", name: "Dhanlaxmi Bank" },
  { id: "jk", sender: "VM-JKBANK-S", name: "J&K Bank" },
  { id: "kerala", sender: "VM-KELBNK-S", name: "Kerala Bank" },
  { id: "kerala_gramin", sender: "VM-KGBANK-S", name: "Kerala Gramin Bank" },
  { id: "saraswat", sender: "VM-SARBNK-S", name: "Saraswat Bank" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;
const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};

/** Messages that move no money yet, or move it between the person's own accounts. `ok` is the only type that may be
 * booked without Review; left out, nothing may be. */
function tricky(bank: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.3,180.00 done at ${bank} CDM in A/c X4407 on 05Oct26.`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.365.00 initiated to ${bank} Card 4407 by PANTRYCO on 2026-10-04. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.488 on ${bank} Card 4407 at PANTRYCO On 2026-10-04 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${bank} Credit Card 4407 payment of Rs.7,720.00 has been received on 05-10-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 4,830.00 from A/c ****4407 to ${bank} Credit Card XX2286 via ${bank} NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX4407 debited for Rs 7,215.00 on 05-Oct-26; ${bank} Credit Card XX2286 credited. UPI:604499112233.` },
    { name: "credit card bill debit", text: `INR 7,360.00 debited from A/c no. XX774407 on CREDIT CARD BILL PAYMENT 05-10-2026 09:14:21 IST. - ${bank}` },
    { name: "mandate set-up", text: `${bank} Acct XX4407 credited Rs 2.00 on 05-Oct-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 286.00 from A/c XX4407 to PANTRYCO has failed. -${bank}` },
    { name: "OTP", text: `718520 is your OTP for a payment of Rs 655.00 at PANTRYCO. Do not share. -${bank}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 187.00 will be debited from A/c XX4407 on 07-10-26 for SongCo. -${bank}` },
  ];
}

describe.each(BANKS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    // A plain message in none of the bank's own shapes: the bank parser reads it, scoring exactly like the generic one.
    const text = "Rs.236.00 debited from A/c XX4407 to VPA corner.kiosk@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    expect(own.parserId).toBe(id);
    expect(own.confidence).toBe(generic(text, RECEIVED, { sender }).confidence);
    expect(own.confidence).toBeLessThan(1);
  });

  it("a debit naming two accounts is booked on the payer's, or on none and held (IndusInd never guesses)", () => {
    const text = "Your a/c no. XXXXXXXX4407 is debited for Rs.615.00 on 05-10-26 and a/c XXXXXX8825 credited (IMPS Ref no 604499114455).";
    const p = money(parseCapture(text, RECEIVED, { sender }));
    if (id === "indusind") {
      expect(p.last4).toBeUndefined();
      expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    } else expect(p.last4).toBe("4407");
  });

  it("a loan account's digits are never the account", () => {
    for (const text of [
      "Rs 2,315.00 debited from your A/c XX4407 for loan a/c no XX9136 EMI on 05-10-26.",
      "Your loan account XX9136 is credited with Rs 2,315.00 by debit to A/c XX4407 on 05-10-26.",
    ]) {
      expect(money(parseCapture(text, RECEIVED, { sender })).last4).toBe("4407");
    }
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `Debited Rs 5 from a/c X4407 on 05Oct26 10:10 via UPI to ${" ".repeat(5000)}x`,
      `IDBI Bank Acct XX4407 debited for Rs 5 on 05-Oct-26; Bal Rs 5 ${"a ".repeat(2500)}credited`,
      `INR 5 spent on YES BANK Card X4407 @UPI_${"A ".repeat(2500)}05-10-2026`,
      `IndusInd A/C Debited; INR 5 Ref-ACH DR ${"/a".repeat(2500)}.Bal INR 5`,
      `A/c X4407 DEBIT:Rs.5 ${"a ".repeat(2500)} Bal:Rs.5`,
      `UPI Credit:INR Rs.5 in A/c X4407. Info: UPI/HDFC/604499116677/ ${"a ".repeat(2500)}`,
      `INR 5 is credited to A/c XXXX4407 on 05-OCT-2026 - "UPI TXN: /604499118899-x/Payment from ${"a".repeat(5000)}`,
      `Your A/c 15${"X".repeat(5000)}4407 has been credited for INR 5`,
      `Dear Customer Your A/c no XXXX4407 is credited with 5.00 on 05-10-2026 by NEFT From : ${"a".repeat(5000)}`,
      `Your A/c no. 4407 is credited with INR 5 on 05-10-2026 towards ACH Credit:${"a ".repeat(2500)}`,
      `Hi, payment of INR 5 for ${"a ".repeat(2500)} via e-mandate ID: x on Federal Bank Debit Card 4407 is processed`,
      `It was sent by ${"a ".repeat(2500)} on October 5, 2026. INR 5 in your Account XXXX4407`,
    ];
    for (const text of pads) {
      const start = performance.now();
      parseCapture(text, RECEIVED, { sender });
      expect(performance.now() - start, text.slice(0, 40)).toBeLessThan(250);
    }
  });
});
