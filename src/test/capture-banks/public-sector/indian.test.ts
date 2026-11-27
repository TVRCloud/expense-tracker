import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Indian Bank sends.
describe("Indian Bank parser", () => {
  readsAll({ sender: "AD-INDBNK-S" }, [
    {
      name: "UPI credit from a UPI id",
      text: "Rs.17.85 credited to a/c *6614 on 04/11/2026 by a/c linked to VPA rohan.s@oksbi (UPI Ref no 631944556677).Indian Bank",
      want: { parserId: "indian", type: "income", amountMinor: 1785, last4: "6614", merchant: "rohan.s@oksbi", ref: "631944556677" },
      auto: true,
    },
    {
      name: "UPI debit stops the payee at the RRN",
      text: "Sent Rs.612.00 from A/c *6614 on 04-11-26 to KAVERI MESS.RRN 631944556788.Avl Bal Rs.2,904.35.Not you? SMS BLOCK to 9811100000-Indian Bank",
      want: { parserId: "indian", type: "expense", amountMinor: 61200, last4: "6614", merchant: "KAVERI MESS", ref: "631944556788" },
      auto: true,
    },
    {
      name: "NEFT credit names the sender between slashes",
      text: "Rs. 18,600 credited to A/c XX6614 on 04/11/2026 at 10:15:00 UTR:SBIN0631944/NEFT/BRIGHT PATH / Avl Bal- Rs. 21,504.35 CR -Indian Bank",
      want: { parserId: "indian", type: "income", amountMinor: 1860000, last4: "6614", merchant: "BRIGHT PATH" },
      auto: true,
    },
    {
      name: "ATM cash has no merchant",
      text: "Rs. 1730 withdrawn from ATM at ANNA NAGAR BRANCH on 04/11/2026.Indian Bank",
      want: { parserId: "indian", type: "expense", amountMinor: 173000, atm: true, merchant: undefined },
    },
  ]);
});
