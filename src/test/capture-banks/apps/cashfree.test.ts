import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175 review: Cashfree's gateway receipts repeat the payment the person's bank records, so no app parser reads
// them; they go to the generic parser as before.
describe("Cashfree receipts", () => {
  readsAll({ sender: "JX-CSHFRE-S" }, [
    {
      name: "are left to the generic parser",
      text: "Payment INR 452.70 (ID:8812203344) confirmed for order #ord_77821 on Lantern Foods.\nPowered by Cashfree",
      want: { kind: "unknown" },
    },
  ]);
});
