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
    {
      name: "cash from an ATM",
      text: "Rs. 2,150.00 debited from your A/c xxxxxx7719 on 04/11/2026 through ATM vide Ref No. 631933445571 To.CASH WDL ATM KAROL BAGH-CBoI",
      want: { parserId: "central", type: "expense", amountMinor: 215000, last4: "7719", atm: true, merchant: undefined },
    },
    {
      name: "a refund still to come keeps only the name and stays in Review",
      text: "Rs. 1,265.00 credited to your A/c xxxxxx7719 on 04/11/2026 through UPI vide Ref No. 631933445572 By.REFUND PIXELSHOP will be credited in 5 days-CBoI",
      want: { parserId: "central" },
      auto: false,
    },
    {
      name: "a credit naming a person",
      text: "Rs. 3,480.00 credited to your A/c xxxxxx7719 on 04/11/2026 through IMPS vide Ref No. 631933445573 By.SUNIL MATHEW-CBoI",
      want: { parserId: "central", type: "income", amountMinor: 348000, last4: "7719", merchant: "SUNIL MATHEW" },
      auto: true,
    },
  ]);
});
