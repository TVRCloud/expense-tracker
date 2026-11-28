import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shapes the Amazon Pay balance sends through Juspay.
describe("Amazon Pay balance (Juspay) parser", () => {
  readsAll({ sender: "JM-JUSPAY-S" }, [
    {
      name: "a payment from the balance names the shop; the balance figure is dropped (no account)",
      text: "Payment of Rs 366.85 using Apay Balance successful at CLOUDBOOKS. Updated Balance is Rs 1,137.15 - SMS by Juspay",
      want: { parserId: "juspay", type: "expense", amountMinor: 36685, merchant: "CLOUDBOOKS", last4: undefined },
      auto: false,
    },
    {
      name: "a debit of the wallet keeps its reference number",
      text: "Your Apay Wallet balance is debited for INR 91.35 Transaction Reference Number is 731199887766 - Powered by Juspay",
      want: { parserId: "juspay", type: "expense", amountMinor: 9135, ref: "731199887766", merchant: undefined },
      auto: false,
    },
    {
      name: "anything not about the Amazon Pay balance goes to the generic parser",
      text: "Rs 521.65 debited from A/c XX4417 to VPA shop.one@okaxis. UPI Ref 736604514471 - Juspay",
      want: { parserId: "generic", type: "expense", amountMinor: 52165 },
    },
  ]);
});

describe("Amazon Pay balance: a phone number is never part of the payee", () => {
  readsAll({ sender: "JM-JUSPAY-S" }, [
    {
      name: "a recharge to a number",
      text: "Payment of Rs 366.85 using Apay Balance successful at CLOUDBOOKS on 9840057316. Updated Balance is Rs 1,137.15 - SMS by Juspay",
      want: { parserId: "juspay", merchant: "CLOUDBOOKS" },
    },
  ]);
});
