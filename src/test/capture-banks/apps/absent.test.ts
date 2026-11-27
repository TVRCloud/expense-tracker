import { describe, expect, it } from "vitest";
import { parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { RECEIVED } from "../helpers";

// Ticket 175: fields an app parse must not carry at all.
const read = (text: string, sender: string) => parseCapture(text, RECEIVED, { sender }) as CaptureParse & Record<string, unknown>;

describe("app parses leave out what does not belong to an account", () => {
  it("a wallet balance with no account is dropped (PhonePe wallet, Amazon Pay balance)", () => {
    const wallet = read("You've paid Rs.48.70 via PhonePe wallet for GREEN BASKET MART. Remaining balance: Rs.211.30.", "JD-PHONPE-S");
    const apay = read("Payment of Rs 366.85 using Apay Balance successful at CLOUDBOOKS. Updated Balance is Rs 1,137.15 - SMS by Juspay", "JM-JUSPAY-S");
    for (const p of [wallet, apay]) {
      expect(p.kind).toBe("money");
      expect("balanceMinor" in p).toBe(false);
      expect("availableLimitMinor" in p).toBe(false);
    }
  });

  it("a spend or a refund on a Jupiter Edge card is never a card payment", () => {
    for (const text of [
      "Rs.63.45 debited to your Edge CSB Bank RuPay Credit Card ending 4417 on 4/11/26 at 9:05 PM. UPI Ref 731122334455.",
      "Refund of Rs.63.45 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 4/11/26.",
    ]) {
      expect(read(text, "VK-JTEDGE-S").cardPayment).toBeUndefined();
    }
  });
});
