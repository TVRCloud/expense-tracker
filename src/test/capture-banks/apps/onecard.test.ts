import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the "You've ..." shape OneCard sends.
describe("OneCard parser", () => {
  readsAll({ sender: "CP-ONECRD-S" }, [
    {
      name: "a transaction on the card",
      text: "You've made a transaction of Rs. 412.00 on PAGE TURNER BOOKS on card ending 4417. Not you? Block via app.",
      want: { parserId: "onecard", type: "expense", amountMinor: 41200, last4: "4417", instrument: "card", merchant: "PAGE TURNER BOOKS" },
      auto: true,
    },
    {
      name: "fuel at a pump",
      text: "You've fueled up for Rs. 1,265.30 at HIGHWAY FUELS on card ending 4417.",
      want: { parserId: "onecard", type: "expense", amountMinor: 126530, last4: "4417", merchant: "HIGHWAY FUELS" },
      auto: true,
    },
    {
      name: "a refund on the card is never read as a spend",
      text: "You've received a refund of Rs. 412.00 from PAGE TURNER BOOKS on card ending 4417.",
      want: { parserId: "onecard", type: "income", amountMinor: 41200, last4: "4417" },
    },
  ]);
});

describe("OneCard: only spend verbs are spends", () => {
  readsAll({ sender: "CP-ONECRD-S" }, [
    {
      name: "a cashback on a shop is income, never a spend",
      text: "You've received a cashback of Rs. 48 on HARBOR BOOKS on card ending 4417.",
      want: { parserId: "onecard", type: "income", amountMinor: 4800, last4: "4417" },
    },
    {
      name: "an earned cashback is income",
      text: "You've earned a cashback of Rs. 48 on card ending 4417.",
      want: { parserId: "onecard", type: "income", amountMinor: 4800 },
    },
    {
      name: "converting an earlier purchase into EMI is not a second spend",
      text: "You've converted a transaction of Rs. 11,850 on GADGET HUB on card ending 4417 into EMI.",
      want: { kind: "unknown" },
    },
    {
      name: "a shop with REFUND in its name stays a spend, and a curly apostrophe is read",
      text: "You’ve made a transaction of Rs. 305.40 on HARBOR BOOKS REFUND DESK on card ending 4417.",
      want: { parserId: "onecard", type: "expense", amountMinor: 30540, merchant: "HARBOR BOOKS REFUND DESK" },
      auto: true,
    },
  ]);
});

describe("OneCard: a bill payment received on the card", () => {
  readsAll({ sender: "CP-ONECRD-S" }, [
    {
      name: "is a card payment, never spending",
      text: "Payment of Rs. 6,110.00 received on card ending 4417. Thank you!",
      want: { parserId: "onecard", cardPayment: true, last4: "4417", amountMinor: 611000 },
      auto: false,
    },
  ]);
});
