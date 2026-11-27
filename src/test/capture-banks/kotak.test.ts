import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("Kotak Mahindra Bank parser", () => {
  readsAll({ sender: "JD-KOTAKB-S" }, [
    {
      name: "UPI debit to a UPI id made of digits",
      text: "Sent Rs.420.00 from Kotak Bank AC X4821 to 9800000001@ybl on 12-11-26.UPI Ref 631200002222. Not you, https://example.com",
      want: { parserId: "kotak", type: "expense", amountMinor: 42000, last4: "4821", merchant: "9800000001@ybl", ref: "631200002222" },
      auto: true,
    },
    {
      name: "UPI credit from a UPI id",
      text: "Received Rs.600.00 in your Kotak Bank AC X4821 from asha.r@okaxis on 12-11-26.UPI Ref 631200003333.",
      want: { parserId: "kotak", type: "income", amountMinor: 60000, last4: "4821", merchant: "asha.r@okaxis" },
      auto: true,
    },
    {
      name: "UPI debit to a name",
      text: "Sent Rs.51.00 from XXXXXX4821 to RAVI KUMAR on 12/11/2026. UPI ref no. 631200004444. Not you? Tap https://example.com to report -Kotak",
      source: { sender: "VM-KOTAKD-S" },
      want: { parserId: "kotak", type: "expense", amountMinor: 5100, last4: "4821", merchant: "RAVI KUMAR", ref: "631200004444" },
      auto: true,
    },
    {
      name: "credit card spend through UPI",
      text: "INR 80 spent on Kotak Credit Card x4821 on 12-NOV-2026 at UPI-631200005555-TEA STALL. Avl limit INR 50000.00",
      want: { parserId: "kotak", type: "expense", amountMinor: 8000, last4: "4821", merchant: "TEA STALL", ref: "631200005555" },
      auto: true,
    },
    {
      name: "refund to a card names the shop",
      text: "INR 150 from CINEPLEX refunded to your Kotak Credit Card x4821 on 12-Nov-2026.",
      want: { parserId: "kotak", type: "income", amountMinor: 15000, last4: "4821", merchant: "CINEPLEX" },
      auto: true,
    },
    {
      name: "IMPS credit from a mobile-linked account has no merchant",
      text: "Received Rs. 329.00 on 12-11-26 in your Kotak Bank A/C x4821 by an A/C linked to mobile x907. IMPS Ref no 631200006666.",
      want: { parserId: "kotak", type: "income", amountMinor: 32900, last4: "4821", merchant: undefined, ref: "631200006666" },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "OTP 552918 for your Kotak Bank txn of Rs 999.00. Do not share it with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
