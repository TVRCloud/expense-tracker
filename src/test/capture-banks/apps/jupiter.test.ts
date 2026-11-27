import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shape Jupiter Edge (CSB Bank RuPay credit card) sends.
describe("Jupiter Edge parser", () => {
  readsAll({ sender: "VK-JTEDGE-S" }, [
    {
      name: "a UPI spend on the card ('debited to your ... Credit Card') is a spend, not a bill payment",
      text: "Rs.63.45 debited to your Edge CSB Bank RuPay Credit Card ending 4417 on 4/11/26 at 9:05 PM. UPI Ref 731122334455.",
      want: { parserId: "jupiter", type: "expense", amountMinor: 6345, last4: "4417", instrument: "card", ref: "731122334455" },
      auto: true,
    },
    {
      name: "a credit to the card with no refund word is a bill payment in Review",
      text: "Rs.2,315.60 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 11/12/26.",
      want: { parserId: "jupiter", cardPayment: true, last4: "4417", amountMinor: 231560 },
      auto: false,
    },
    {
      name: "a refund to the card is income on the card",
      text: "Refund of Rs.63.45 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 4/11/26.",
      want: { parserId: "jupiter", type: "income", last4: "4417" },
    },
  ]);
});
