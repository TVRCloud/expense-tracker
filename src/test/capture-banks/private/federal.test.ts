import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shape Federal Bank sends (fake amounts, digits, refs and names).
describe("Federal Bank parser", () => {
  readsAll({ sender: "VM-FEDBNK-S" }, [
    {
      name: "UPI debit with the account and balance",
      text: "Debited Rs 318.40 from a/c X6152 on 04Oct26 19:21 via UPI to tinyteahouse@oksbi. Ref 604377001122.Bal Rs 8,412.10. Not you?Call 0000000000 -Federal Bank",
      want: { parserId: "federal", type: "expense", amountMinor: 31840, last4: "6152", merchant: "tinyteahouse@oksbi", ref: "604377001122", balanceMinor: 841210 },
      auto: true,
    },
    {
      name: "UPI debit that names no account",
      text: "Rs 742.00 debited via UPI on 04-10-2026 08:41:12 to VPA greenleaf.mart@okhdfc.Ref No 604377003344.Small txns?Use UPI Lite!-Federal Bank",
      want: { parserId: "federal", type: "expense", amountMinor: 74200, last4: undefined, merchant: "greenleaf.mart@okhdfc", ref: "604377003344" },
    },
    {
      name: "IMPS credit",
      text: "Rs 2,160.00 credited to your A/c XX6152 via IMPS on 04OCT2026 13:05:51 IMPS Ref no 604377005566 Bal:Rs 10,572.10 -Federal Bank",
      want: { parserId: "federal", type: "income", amountMinor: 216000, last4: "6152", ref: "604377005566", balanceMinor: 1057210 },
      auto: true,
    },
    {
      name: "money received, written to the person by name",
      text: "Meera, you've received INR 3,425.00 in your Account XXXXXXXX6152. Woohoo! It was sent by ANIL KUMAR on October 4, 2026. -Federal Bank",
      want: { parserId: "federal", type: "income", amountMinor: 342500, last4: "6152", merchant: "ANIL KUMAR" },
    },
    {
      name: "card payment under an e-mandate names the payee and the card",
      text: "Hi, payment of INR 349.00 for TuneBox via e-mandate ID: TB55QWERT12 on Federal Bank Debit Card 6152 is processed successfully. To manage, visit: https://example.com T&CA - Federal Bank",
      want: { parserId: "federal", type: "expense", amountMinor: 34900, last4: "6152", instrument: "card", merchant: "TuneBox" },
      auto: true,
    },
  ]);
});
