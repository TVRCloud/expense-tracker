import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shapes slice sends.
describe("slice parser", () => {
  readsAll({ sender: "AD-SLCEIT-S" }, [
    {
      name: "a UPI payment with no account digits names the payee and stays in Review",
      text: "Sent Rs.85 to MEENA STORES (UPI transaction success). Sent from slice.",
      want: { parserId: "slice", type: "expense", amountMinor: 8500, merchant: "MEENA STORES", last4: undefined },
      auto: false,
    },
    {
      name: "a credit card spend with its digits",
      text: "Rs. 67 spent on your credit card xx4417 at BAKE HOUSE on 11-Nov-26 (UPI Ref: 731100998877). Not you? Call 080-4631-7720 - slice",
      want: { parserId: "slice", type: "expense", amountMinor: 6700, last4: "4417", merchant: "BAKE HOUSE", ref: "731100998877" },
      auto: true,
    },
    {
      name: "an online card transaction with no debit word is a spend (Review: no digits)",
      text: "Your slice credit card transaction of RS. 899 on shopkart.in is successful. If not you, call 080-4631-7720 - slice",
      source: { sender: "AX-SLICEIT-S" },
      want: { parserId: "slice", type: "expense", amountMinor: 89900, merchant: "shopkart.in" },
      auto: false,
    },
    {
      name: "money received into the slice bank account",
      text: "You've got ₹740 from ARJUN NAIR in your slice bank a/c xx4417. UPI Ref 731100776655.",
      source: { sender: "VA-SLCBNK-S" },
      want: { parserId: "slice", type: "income", amountMinor: 74000, last4: "4417", merchant: "ARJUN NAIR" },
      auto: true,
    },
    {
      name: "a credit card repayment is a card payment, never income",
      text: "Repayment of Rs.2,315 received for the slice credit card. Thank you!",
      source: { sender: "VA-SLCBNK-S" },
      want: { parserId: "slice", cardPayment: true, amountMinor: 231500 },
      auto: false,
    },
    {
      name: "an AutoPay debit from the account names the payee",
      text: "paid Rs.199 from slice a/c xx4417 to TUNEFLOW MEDIA on 11-Nov-26 via UPI AutoPay",
      source: { sender: "VA-SLCBNK-S" },
      want: { parserId: "slice", type: "expense", amountMinor: 19900, last4: "4417", merchant: "TUNEFLOW MEDIA" },
      auto: true,
    },
  ]);
});
