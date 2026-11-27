import { describe } from "vitest";
import { readsAll } from "./helpers";
import { styled } from "./styled";

describe("SBI parser", () => {
  readsAll({ sender: "JD-SBIUPI-S" }, [
    {
      name: "debit card spend with no debit word",
      text: "Dear Customer, transaction number 8806 for Rs.512.30 by SBI Debit Card 7731 done at GREENBASKET on 03Oct26 at 18:02:55. Your updated available balance is Rs.12,440.10. If not done by you, forward this SMS to 9400011122/ call 1800555666",
      source: { sender: "AD-ATMSBI-S" },
      want: { parserId: "sbi", type: "expense", amountMinor: 51230, last4: "7731", instrument: "card", merchant: "GREENBASKET" },
      auto: true,
    },
    {
      name: "the shop stops before 'on your card'",
      text: "Dear Customer, Rs.699.00 by SBI Credit Card 7731 done at CLOUDAPP on your SBI Credit Card ending 7731 on 03Oct26.",
      source: { sender: "VM-SBICRD" },
      want: { parserId: "sbi", merchant: "CLOUDAPP" },
    },
    {
      name: "a cash deposit 'done at' a machine is never an expense",
      text: "Dear Customer, Cash deposit of Rs.6,550.00 done at SBI CDM S1NW000912 in A/c X7731 on 03Oct26 at 10:26. Avl Bal Rs.9,940. -SBI",
      source: { sender: "VM-CBSSBI" },
      // No debit word and not the card-spend shape: not read as money at all, so it waits in Review.
      want: { kind: "unknown" },
    },
    {
      name: "UPI debit with a bare amount",
      text: "Dear UPI user A/C X7731 debited by 147.0 on date 03Oct26 trf to NEELAM STORES Refno 604455556666. If not u? call 1800555666. -SBI",
      want: { parserId: "sbi", type: "expense", amountMinor: 14700, last4: "7731", merchant: "NEELAM STORES", ref: "604455556666" },
      auto: true,
    },
    {
      name: "UPI debit to a phone number has no merchant",
      text: "Dear UPI user A/C X7731 debited by 64.0 on date 03Oct26 trf to 9700033344 Refno 604455550000. -SBI",
      want: { parserId: "sbi", merchant: undefined },
    },
    {
      name: "UPI credit with the account glued to its mask",
      text: "Dear SBI UPI User, ur A/cX7731 credited by Rs835 on 03Oct26 by (Ref no 604466667777)",
      want: { parserId: "sbi", type: "income", amountMinor: 83500, last4: "7731" },
      auto: true,
    },
    {
      name: "credit card spend",
      text: "Rs.2,318.00 spent on your SBI Credit Card ending with 7731 at PAPERLEAF on 03/10/26. Trxn. not done by you? Report at https://example.com",
      source: { sender: "VM-SBICRD" },
      want: { parserId: "sbi", type: "expense", amountMinor: 231800, last4: "7731", merchant: "PAPERLEAF" },
      auto: true,
    },
    {
      name: "card bill payment goes to Review",
      text: "Your payment of Rs.5,730.00 has been credited to your SBI Credit Card ending with 7731. Your available limit is Rs.71,204.00.",
      source: { sender: "VM-SBICRD" },
      want: { parserId: "sbi", cardPayment: true, last4: "7731" },
      auto: false,
    },
    {
      name: "ATM withdrawal",
      text: "Dear Customer, Rs.2550 withdrawn at SBI ATM S1BW000488 from A/cX7731 on 03Oct26 Transaction Number 6120. Available Balance Rs.7380. If not withdrawn by you, call 1800555666.",
      source: { sender: "VM-ATMSBI" },
      want: { parserId: "sbi", type: "expense", amountMinor: 255000, last4: "7731", atm: true, merchant: undefined },
    },
    {
      name: "styled letters read as plain text",
      text: `Rs.47.00 ${styled("debited from A/c X7731 on 03Oct26 to NEELAM STORES")}`,
      want: { parserId: "sbi", type: "expense", amountMinor: 4700, last4: "7731", merchant: "NEELAM STORES" },
    },
    {
      name: "a styled OTP is ignored",
      text: styled("604213 is your OTP for Rs 765. Do not share."),
      want: { kind: "ignored", reason: "otp" },
    },
    {
      name: "a bill due notice is ignored",
      text: "SBI Card Bill Pay Alert! Dear Cardholder, you have a new GREENGRID bill for Rs. 1,214.00 due by 17-Oct-2026. Click here to pay now. - SBI Card",
      source: { sender: "VM-SBICRD" },
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
