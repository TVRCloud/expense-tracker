import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 174: invented messages in Standard Chartered India's shapes.
describe("Standard Chartered parser", () => {
  readsAll({ sender: "AD-SCBANK-S" }, [
    {
      name: "UPI debit takes the person's account, never the payee's",
      text: "Your a/c XX5832 is debited for Rs. 418.00 on 14-10-2026 18:22 and credited to a/c XX9046 (UPI Ref no 629311224455).Plz call 18004190336 if not done by you.",
      want: { parserId: "standard_chartered", type: "expense", amountMinor: 41800, last4: "5832", merchant: undefined, ref: "629311224455" },
      auto: true,
    },
    {
      name: "NEFT credit written as a noun",
      text: "Dear Customer, there is an NEFT credit of INR 31,250.00 in your account 412xxxx5832 on 14/10/2026.Available Balance:INR 64,118.20 -StanChart",
      want: { parserId: "standard_chartered", type: "income", amountMinor: 3125000, last4: "5832", balanceMinor: 6411820 },
      auto: true,
    },
    {
      name: "IMPS credit written as a noun",
      text: "Dear Customer, there is an IMPS credit of INR 2,460.00 in your account 412xxxx5832 on 14/10/2026.Available Balance:INR 66,518.20 -StanChart",
      want: { parserId: "standard_chartered", type: "income", amountMinor: 246000, last4: "5832" },
      auto: true,
    },
    {
      name: "a debit written as a noun",
      text: "Dear Customer, there is an IMPS debit of INR 1,050.00 from your account 412xxxx5832 on 14/10/2026.Available Balance:INR 65,468.20 -StanChart",
      want: { parserId: "standard_chartered", type: "expense", amountMinor: 105000, last4: "5832" },
      auto: true,
    },
    {
      name: "RTGS credit written as a noun",
      text: "Dear Customer, there is an RTGS credit of INR 2,85,000.00 in your account 412xxxx5832 on 15/10/2026.Available Balance:INR 3,49,118.20 -StanChart",
      want: { parserId: "standard_chartered", type: "income", amountMinor: 28500000, last4: "5832", balanceMinor: 34911820 },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "605172 is the OTP for your StanChart txn of Rs 1,265.00. Never share it. -StanChart",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
