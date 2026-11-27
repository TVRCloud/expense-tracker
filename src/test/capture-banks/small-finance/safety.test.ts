import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 173: the rules every bank parser must keep (from tickets 155-157), for the small finance and payments banks.
// Invented messages only.
const BANKS = [
  { id: "au", sender: "VM-AUBANK-S", name: "AU Bank" },
  { id: "bandhan", sender: "AD-BDNSMS-S", name: "Bandhan Bank" },
  { id: "equitas", sender: "CP-EQUTAS-S", name: "Equitas" },
  { id: "utkarsh", sender: "VM-UTKSPR-S", name: "Utkarsh SFB" },
  { id: "jana", sender: "JM-JANABK-S", name: "JANA SFB" },
  { id: "suryoday", sender: "JM-SSFBNK-T", name: "Suryoday SFB" },
  { id: "airtel_pb", sender: "AD-AIRBNK-S", name: "Airtel Payments Bank" },
  { id: "ippb", sender: "VM-IPBMSG-S", name: "IPPB" },
  { id: "jio_pb", sender: "JD-JIOPBS-S", name: "Jio Payments Bank" },
  { id: "nsdl_pb", sender: "AD-NSDLPB-S", name: "NSDL Payments Bank" },
];

const generic = createCaptureParser([]);
const booked = (p: CaptureParse) => p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE;

/** Messages that move no money yet, or move it between the person's own accounts. `ok` is the only type that may
 * be booked without Review; left out, nothing may be. */
function tricky(bank: string): { name: string; text: string; ok?: "income" }[] {
  return [
    { name: "cash deposit", text: `Cash deposit of Rs.3,815.00 done at ${bank} CDM in A/c X2241 on 14Nov26.`, ok: "income" },
    { name: "refund initiated", text: `Refund of Rs.355.00 initiated to ${bank} Card 2241 by HOMEMART on 2026-11-13. It will reflect in 5-7 days.` },
    { name: "reversal to come", text: `Txn of Rs.468 on ${bank} Card 2241 at TOYLAND On 2026-11-13 reversed. Amount will be credited in 7 days.` },
    { name: "card bill payment received", text: `Your ${bank} Credit Card 2241 payment of Rs.7,640.00 has been received on 14-11-26. Thank you.` },
    { name: "payment to a credit card", text: `Payment Successful! Rs. 4,480.00 from A/c ****2241 to ${bank} Credit Card XX8136 via ${bank} NetBanking.` },
    { name: "payment credited to a card", text: `Acct XX2241 debited for Rs 6,915.00 on 14-Nov-26; ${bank} Credit Card XX8136 credited. UPI:638300112233.` },
    { name: "credit card bill debit", text: `INR 7,725.00 debited from A/c no. XX772241 on CREDIT CARD BILL PAYMENT 14-11-2026 11:15:20 IST. - ${bank}` },
    { name: "mandate set-up", text: `${bank} Acct XX2241 credited Rs 1.40 on 14-Nov-26. Info NACH*MANDATE REGISTRATION*SETUP.` },
    { name: "failed payment", text: `Your txn of Rs 284.00 from A/c XX2241 to TOYLAND has failed. -${bank}` },
    { name: "OTP", text: `730592 is your OTP for a payment of Rs 612.00 at TOYLAND. Do not share. -${bank}` },
    { name: "pre-debit notice", text: `Pre-debit alert: Rs 189.00 will be debited from A/c XX2241 on 16-11-26 for TuneBay. -${bank}` },
  ];
}

describe.each(BANKS)("$id: safety", ({ id, sender, name }) => {
  it.each(tricky(name))("$name is never booked as the wrong type", ({ text, ok }) => {
    const p = parseCapture(text, RECEIVED, { sender });
    if (booked(p) && p.kind === "money") expect(p.type).toBe(ok);
    if (booked(p)) expect(ok).toBeDefined();
  });

  it("the sender alone earns no bonus", () => {
    const text = "Rs.198.00 debited from A/c XX2241 to VPA corner.store@ybl.";
    const own = parseCapture(text, RECEIVED, { sender });
    expect(own.parserId).toBe(id);
    expect(own.confidence).toBe(generic(text, RECEIVED, { sender }).confidence);
  });

  it("takes the payer's account on a two-account debit and never a loan account", () => {
    const two = parseCapture(
      "Your a/c no. XXXXXXXX2241 is debited for Rs.330.00 on 14-11-26 and a/c XXXXXX9067 credited (IMPS Ref no 638300114455).",
      RECEIVED,
      { sender }
    );
    expect(two.kind === "money" && two.last4).toBe("2241");
    for (const text of [
      "Rs 2,140.00 debited from your A/c XX2241 for loan a/c no XX8803 EMI on 14-11-26.",
      "Your loan a/c no XX8803 is credited with Rs 2,140.00 by debit to A/c XX2241 on 14-11-26.",
    ]) {
      const p = parseCapture(text, RECEIVED, { sender });
      expect(p.kind === "money" && p.last4, text).toBe("2241");
    }
  });

  it("a long, padded message parses quickly", () => {
    const pads = [
      `Debited INR 5 from A/c X2241 on x UPI/DR/908172/${"a ".repeat(2500)}`,
      `INR 5 debited from A/c XX2241 towards UPI/DR/D908172/${" ".repeat(5000)}Value`,
      `INR 5 debited via UPI from Equitas A/c 2241 ${"-".repeat(5000)} to x`,
      `Rs 5 spent on ${"Big ".repeat(1200)}Suryoday SFB CC 2241 Avlb Rs ${"1".repeat(3000)}`,
      `Your acct XX224 is debited with INR 5 on x to ${"a.".repeat(2500)}@ybl`,
      `A/c XX2241 debited Rs 5 for linked ${"x".repeat(5000)}@oksbi`,
      `Rs. 5 Sent from x2241 to ${"y".repeat(5000)}`,
      `You have received a payment of Rs.5 in a/c X2241 from ${"a ".repeat(2500)} thru IPPB`,
      `Rs.5 spent on your Utkarsh SuperCard XX2241 for ${"b ".repeat(2500)} on x`,
      `Rs.5 spent on your Utkarsh SuperCard XX2241 for UPI - ${"c".repeat(5000)}@ybl`,
    ];
    for (const text of pads) {
      const start = performance.now();
      parseCapture(text, RECEIVED, { sender });
      expect(performance.now() - start).toBeLessThan(250);
    }
  });
});
