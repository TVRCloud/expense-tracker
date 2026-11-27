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
