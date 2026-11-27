import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shape Jupiter Edge (CSB Bank RuPay credit card) sends.
describe("Jupiter Edge parser", () => {
  readsAll({ sender: "VK-JTEDGE-S" }, [
    {
      name: "a UPI spend on the card ('debited to your ... Credit Card') is a spend, not a bill payment",
      text: "Rs.63.45 debited to your Edge CSB Bank RuPay Credit Card ending 4417 on 10/28/26, 9:05 PM. UPI Ref 736604518827.",
      want: { parserId: "jupiter", type: "expense", amountMinor: 6345, last4: "4417", instrument: "card", ref: "736604518827", date: new Date("2026-10-28T15:35:00Z"), hasTime: true },
      auto: true,
    },
    {
      name: "a credit to the card with no refund word is a bill payment in Review",
      text: "Rs.2,315.60 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 11/9/26.",
      want: { parserId: "jupiter", cardPayment: true, last4: "4417", amountMinor: 231560 },
      auto: false,
    },
    {
      name: "a refund to the card is income on the card",
      text: "Refund of Rs.63.45 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 11/9/26.",
      want: { parserId: "jupiter", type: "income", last4: "4417" },
    },
  ]);
});

describe("Jupiter Edge: month-first dates and promo lines", () => {
  readsAll({ sender: "VK-JTEDGE-S" }, [
    {
      name: "a day of 12 or less is read month first (11/5/26 is 5 November, not 11 May)",
      text: "Rs.41.20 debited to your Edge CSB Bank RuPay Credit Card ending 4417 on 11/5/26, 7:12 PM. UPI Ref 736604519938.",
      want: { parserId: "jupiter", date: new Date("2026-11-05T13:42:00Z"), hasTime: true },
    },
    {
      name: "a date that would be after the message arrived is not trusted",
      text: "Rs.41.20 debited to your Edge CSB Bank RuPay Credit Card ending 4417 on 12/9/26. UPI Ref 736604517749.",
      want: { parserId: "jupiter", date: undefined, hasTime: false },
    },
    {
      name: "a promo line after a credit does not stop it being a bill payment",
      text: "Rs.2,315.60 credited to your Edge CSB Bank RuPay Credit Card ending 4417 on 11/9/26. Earn cashback on every UPI spend with Edge!",
      want: { parserId: "jupiter", cardPayment: true, last4: "4417" },
      auto: false,
    },
  ]);
});
