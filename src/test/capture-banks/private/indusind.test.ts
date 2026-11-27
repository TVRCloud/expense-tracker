import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shape IndusInd Bank sends.
describe("IndusInd Bank parser", () => {
  readsAll({ sender: "VM-INDUSB-S" }, [
    {
      name: "UPI debit names the payee after 'towards'",
      text: "A/c *XX6152 debited by Rs 455.00 towards orchard.cafe@okicici. RRN: 604377011122. Not You? call 0000000000- IndusInd Bank.",
      want: { parserId: "indusind", type: "expense", amountMinor: 45500, last4: "6152", merchant: "orchard.cafe@okicici", ref: "604377011122" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "A/C *XX6152 credited by Rs 12,150.00 from nisha.p@ybl. RRN:604377013344. Avl Bal:42,318.20. Not you? Call 0000000000 - IndusInd bank.",
      want: { parserId: "indusind", type: "income", amountMinor: 1215000, last4: "6152", merchant: "nisha.p@ybl", balanceMinor: 4231820 },
      auto: true,
    },
    {
      name: "credit card spend",
      text: "INR 2,375.00 spent on IndusInd Card XX6152 on 04-10-2026 07:48:15 pm at BLUEFIN GROCERS. Avl Lmt: INR 61,625.00. To dispute, call 0000000000/SMS BLOCK 6152 to 0000000",
      want: { parserId: "indusind", type: "expense", amountMinor: 237500, last4: "6152", instrument: "card", merchant: "BLUEFIN GROCERS", availableLimitMinor: 6162500 },
      auto: true,
    },
    {
      name: "debit card purchase on a partly shown account number",
      text: "INR 799.00 debited from your A/C 201***046152 towards Debit Card Purchase. Avl BAL INR 9,420.80 - Not you? Call 0000000000 to report issue - IndusInd Bank.",
      want: { parserId: "indusind", type: "expense", amountMinor: 79900, last4: "6152", merchant: undefined },
      auto: true,
    },
    {
      name: "IMPS credit on an account written with its first digits",
      text: "Your IndusInd Account 15XXXXX6152 has been credited for INR 340.25 towards IMPS/604377039911. Call 0000000000 to report issue-IndusInd Bank",
      want: { parserId: "indusind", type: "income", amountMinor: 34025, last4: "6152" },
      auto: true,
    },
    {
      name: "deposit interest is money in, kept in Review (no account)",
      text: "Net interest INR 61.40 paid on your IndusInd Deposit No 300***418273 on 30/09/26. Call 0000000000 for assistance - IndusInd Bank",
      want: { parserId: "indusind", type: "income", amountMinor: 6140, last4: undefined, merchant: undefined },
      auto: false,
    },
  ]);
});
