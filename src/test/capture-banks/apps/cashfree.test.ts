import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shape Cashfree's payment receipts take.
describe("Cashfree parser", () => {
  readsAll({ sender: "JX-CSHFRE-S" }, [
    {
      name: "a receipt names the shop and is always kept in Review (the paying bank records the same payment)",
      text: "Payment INR 452.70 (ID:8812203344) confirmed for order #ord_77821 on Lantern Foods.\nPowered by Cashfree",
      want: { parserId: "cashfree", type: "expense", amountMinor: 45270, merchant: "Lantern Foods", ref: "8812203344", last4: undefined },
      auto: false,
    },
    {
      name: "a mixed-case header is matched too",
      text: "Payment INR 1,099.00 (ID:8812209955) confirmed for order #A-5521 on Bright Tutors Academy.\nPowered by Cashfree",
      source: { sender: "VK-CSHfre-T" },
      want: { parserId: "cashfree", amountMinor: 109900, merchant: "Bright Tutors Academy" },
      auto: false,
    },
    {
      name: "a message that is not a receipt goes to the generic parser",
      text: "Pay securely with UPI or cards. Powered by Cashfree",
      want: { kind: "unknown" },
    },
  ]);
});
