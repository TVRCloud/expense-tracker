import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shape YES BANK sends.
describe("YES BANK parser", () => {
  readsAll({ sender: "VM-YESBNK-S" }, [
    {
      name: "card spend through UPI names the shop after @UPI_",
      text: "INR 186.50 spent on YES BANK Card X6152 @UPI_RIVERSIDE BAKES 04-10-2026 09:12:44 am. Avl Lmt INR 84,213.50. SMS BLKCC 6152 to 0000000000 if not you",
      want: { parserId: "yes", type: "expense", amountMinor: 18650, last4: "6152", instrument: "card", merchant: "RIVERSIDE BAKES", availableLimitMinor: 8421350 },
      auto: true,
    },
    {
      name: "card spend at a shop",
      text: "INR 1,240.00 spent on YES BANK Card X6152 @AMAZON PAY INDIA 04-10-2026 10:22:01 pm. Avl Lmt INR 82,973.50. SMS BLKCC 6152 to 0000000000 if not you",
      want: { parserId: "yes", type: "expense", amountMinor: 124000, last4: "6152", merchant: "AMAZON PAY INDIA" },
      auto: true,
    },
    {
      name: "a bill due is ignored",
      text: "Your Yes Bank Credit Card payment of INR 6,500 is due by 15-10-2026",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
