import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 174: invented messages in HSBC India's shapes (fake amounts, digits, refs and names).
describe("HSBC parser", () => {
  readsAll({ sender: "VM-HSBCIN-S" }, [
    {
      name: "NEFT credit names the person's account, never the payer's",
      text: "HSBC: A/c 118-402***-731 is credited with INR 6,240.00 on 14OCT at 09.12.40 with UTR UTIBR52026101400418 as NEFT from UTIB A/c ***2271 of MEERA IYER . Your Avl Bal is INR 21,906.35.",
      want: { parserId: "hsbc", type: "income", amountMinor: 624000, last4: "731", instrument: "account", merchant: "MEERA IYER", balanceMinor: 2190635 },
      auto: true,
    },
    {
      name: "short NEFT credit",
      text: "HSBC: INR 2,870.00 is credited to your A/c 118-402***-731 as NEFT from UTIB A/c ***2271 of MEERA IYER .",
      want: { parserId: "hsbc", type: "income", amountMinor: 287000, last4: "731", merchant: "MEERA IYER" },
      auto: true,
    },
    {
      name: "bill paid from the account",
      text: "HSBC: INR 1,415.25 is paid from your A/c 118-402***-731 to TATA POWER DDL on 14-Oct-26. Your Avl Bal is INR 20,491.10 .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 141525, last4: "731", merchant: "TATA POWER DDL", balanceMinor: 2049110 },
      auto: true,
    },
    {
      name: "payment from a fully masked account with a ref",
      text: "HSBC: INR 655.00 is paid from account XXXXXX5832 to METRO CARD RECHARGE on 14OCT with ref 629310045512. Your available bal is INR 9,315.40.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 65500, last4: "5832", merchant: "METRO CARD RECHARGE", ref: "629310045512" },
      auto: true,
    },
    {
      name: "debit card spend: two digits are too few to name an account",
      text: "HSBC: Thank you for using HSBC Debit Card XXXXX58xx for INR 214.00 on 14-Oct-26 at FRESHMART GURGAON .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 21400, last4: undefined, merchant: "FRESHMART GURGAON" },
    },
    {
      name: "debit card spend, shop before the amount",
      text: "Thank you for using HSBC Debit Card XXXXX58xx at CAFE ALTO . for INR 94.00 on 14-10-26.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 9400, last4: undefined, merchant: "CAFE ALTO" },
    },
    {
      name: "credit card spend",
      text: "Your HSBC creditcard xxxxx5832 used at BOOKNOOK for INR 1,180.00 on 14-10-26.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 118000, last4: "5832", instrument: "card", merchant: "BOOKNOOK" },
      auto: true,
    },
    {
      name: "outgoing NEFT is money out, never on the beneficiary's account",
      text: "HSBC: Dear HSBC Customer, your NEFT transaction with reference number HSBCN00203391744 for INR 42,500.00 has been credited to the ICICI A/c XXXXXXXX7710 of RAHUL NAIR on 14-10-2026 at 11:20:05 .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 4250000, last4: undefined, merchant: "RAHUL NAIR" },
      auto: false,
    },
    {
      name: "an OTP is ignored",
      text: "HSBC: 583014 is your OTP for a txn of INR 2,140.00 at BOOKNOOK. Do not share it.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
