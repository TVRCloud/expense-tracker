import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape UCO Bank sends.
describe("UCO Bank parser", () => {
  readsAll({ sender: "VK-UCOBNK-S" }, [
    {
      name: "UPI debit: the channel is never the payee",
      text: "A/c XX8840 Debited with Rs.475.00 on 04-11-2026 by UCO-UPI.Avl Bal Rs.6,322.90. Report Dispute https://example.com",
      want: { parserId: "uco", type: "expense", amountMinor: 47500, last4: "8840", merchant: undefined, balanceMinor: 632290 },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "A/c XX8840 Credited with Rs.1,925.00 on 04-11-2026 by UCO-UPI.Avl Bal Rs.8,247.90. Report Dispute https://example.com -UCO Bank",
      want: { parserId: "uco", type: "income", amountMinor: 192500, last4: "8840", merchant: undefined },
      auto: true,
    },
  ]);
});
