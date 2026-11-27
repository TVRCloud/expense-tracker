import { describe } from "vitest";
import { readsAll } from "./helpers";

// Mathematical sans-serif bold, the styled letters some SBI alerts use.
function styled(text: string): string {
  return [...text]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (c >= "A" && c <= "Z") return String.fromCodePoint(0x1d5d4 + code - 65);
      if (c >= "a" && c <= "z") return String.fromCodePoint(0x1d5ee + code - 97);
      if (c >= "0" && c <= "9") return String.fromCodePoint(0x1d7ec + code - 48);
      return c;
    })
    .join("");
}

describe("SBI parser", () => {
  readsAll({ sender: "JD-SBIUPI-S" }, [
    {
      name: "debit card spend with no debit word",
      text: "Dear Customer, transaction number 5521 for Rs.640.00 by SBI Debit Card 4821 done at FRESHMART on 12Nov26 at 19:20:11. Your updated available balance is Rs.9,000.00. If not done by you, forward this SMS to 9000000000/ call 1800000000",
      source: { sender: "AD-ATMSBI-S" },
      want: { parserId: "sbi", type: "expense", amountMinor: 64000, last4: "4821", instrument: "card", merchant: "FRESHMART" },
      auto: true,
    },
    {
      name: "UPI debit with a bare amount",
      text: "Dear UPI user A/C X4821 debited by 250.0 on date 12Nov26 trf to RAJ STORES Refno 631277778888. If not u? call 1800000000. -SBI",
      want: { parserId: "sbi", type: "expense", amountMinor: 25000, last4: "4821", merchant: "RAJ STORES", ref: "631277778888" },
      auto: true,
    },
    {
      name: "UPI credit with the account glued to its mask",
      text: "Dear SBI UPI User, ur A/cX4821 credited by Rs500 on 12Nov26 by (Ref no 631211112222)",
      want: { parserId: "sbi", type: "income", amountMinor: 50000, last4: "4821" },
      auto: true,
    },
    {
      name: "credit card spend",
      text: "Rs.1,299.00 spent on your SBI Credit Card ending with 4821 at BOOKNOOK on 12/11/26. Trxn. not done by you? Report at https://example.com",
      source: { sender: "VM-SBICRD" },
      want: { parserId: "sbi", type: "expense", amountMinor: 129900, last4: "4821", merchant: "BOOKNOOK" },
      auto: true,
    },
    {
      name: "card bill payment goes to Review",
      text: "Your payment of Rs.4,000.00 has been credited to your SBI Credit Card ending with 4821. Your available limit is Rs.60,000.00.",
      source: { sender: "VM-SBICRD" },
      want: { parserId: "sbi", cardPayment: true, last4: "4821" },
      auto: false,
    },
    {
      name: "ATM withdrawal",
      text: "Dear Customer, Rs.2000 withdrawn at SBI ATM S1BW000123 from A/cX4821 on 12Nov26 Transaction Number 4455. Available Balance Rs.5000. If not withdrawn by you, call 1800000000.",
      source: { sender: "VM-ATMSBI" },
      want: { parserId: "sbi", type: "expense", amountMinor: 200000, last4: "4821", atm: true },
    },
    {
      name: "styled letters read as plain text",
      text: `Rs.90.00 ${styled("debited from A/c X4821 on 12Nov26 to RAJ STORES")}`,
      want: { parserId: "sbi", type: "expense", amountMinor: 9000, last4: "4821", merchant: "RAJ STORES" },
    },
    {
      name: "a styled OTP is never money",
      text: styled("482913 is your OTP for Rs 500. Do not share."),
      want: { kind: "unknown" },
    },
    {
      name: "a bill due notice is ignored",
      text: "SBI Card Bill Pay Alert! Dear Cardholder, you have a new CITY POWER bill for Rs. 850.00 due by 22-Nov-2026. Click here to pay now. - SBI Card",
      source: { sender: "VM-SBICRD" },
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
