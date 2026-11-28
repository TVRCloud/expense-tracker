import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Bank of India sends.
describe("Bank of India parser", () => {
  readsAll({ sender: "BZ-BOIIND-S" }, [
    {
      name: "UPI debit naming both sides is money out, not an unsure read",
      text: "Rs.418.00 debited A/cXX2846 and credited to PRAKASH DAIRY via UPI Ref No 631922334455 on 04Nov26. Call 18001234, if not done by you. -BOI",
      want: { parserId: "boi", type: "expense", amountMinor: 41800, last4: "2846", merchant: "PRAKASH DAIRY", ref: "631922334455" },
      auto: true,
    },
    {
      name: "NEFT credit names the sender after the code",
      text: "BOI - Rs 12,400.00 Credited in your Ac XX2846 on 04-11-2026 By NEFTINWARD ICIC0031415926/ACME SOFTWARE .Avl Bal 15,612.30",
      want: { parserId: "boi", type: "income", amountMinor: 1240000, last4: "2846", merchant: "ACME SOFTWARE" },
      auto: true,
    },
    {
      name: "a cash deposit machine is never the payer",
      text: "BOI - Cash Rs. 3,150 deposited in your account XX2846 from Cash Acceptor Machine R0412345 at LINK ROAD ON 04-11-2026. Available balance Rs. 18,612.30",
      want: { parserId: "boi", type: "income", amountMinor: 315000, last4: "2846", merchant: undefined },
    },
  ]);
});
