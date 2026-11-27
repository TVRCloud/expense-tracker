import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Central Bank of India sends.
describe("Central Bank of India parser", () => {
  readsAll({ sender: "CP-CENTBK-S" }, [
    {
      name: "NEFT credit names the sender before the sign-off",
      text: "Rs. 1,640.00 credited to your A/c xxxxxx7719 on 04/11/2026 through NEFT vide Ref No./N308261122 By.VEDANT TRADING CO-CBoI",
      want: { parserId: "central", type: "income", amountMinor: 164000, last4: "7719", merchant: "VEDANT TRADING CO", ref: "N308261122" },
      auto: true,
    },
    {
      name: "UPI debit names the payee",
      text: "Rs. 535.00 debited from your A/c xxxxxx7719 on 04/11/2026 through UPI vide Ref No. 631933445566 To.GREEN BASKET-CBoI",
      want: { parserId: "central", type: "expense", amountMinor: 53500, last4: "7719", merchant: "GREEN BASKET", ref: "631933445566" },
      auto: true,
    },
  ]);
});
