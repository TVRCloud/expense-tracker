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
      auto: true,
    },
    {
      name: "debit card spend, shop before the amount",
      text: "Thank you for using HSBC Debit Card XXXXX58xx at CAFE ALTO . for INR 94.00 on 14-10-26.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 9400, last4: undefined, merchant: "CAFE ALTO" },
      auto: true,
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
      name: "NEFT debit: the payee after 'of', never the time or the UTR, and never the payee's account",
      text: "HSBC: A/c 118-402***-731 is debited with INR 3,165.00 on 06NOV at 11.47.09 with UTR HSBCN0058213 as NEFT to PUNB A/c ***5027 of DEEPA MENON . Your Avl Bal is INR 7,342.15.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 316500, last4: "731", merchant: "DEEPA MENON" },
      auto: true,
    },
    {
      name: "UPI debit: the UPI id, never the time",
      text: "HSBC: A/c 118-402***-731 is debited with INR 785.00 on 06NOV at 11.47.09 for UPI to anil.k@okhdfc .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 78500, last4: "731", merchant: "anil.k@okhdfc" },
      auto: true,
    },
    {
      name: "mandate debit: the payee after the mandate words",
      text: "HSBC: A/c 118-402***-731 is debited with INR 449.00 on 06NOV at 11.47.09 towards NACH mandate SKYLINE BROADBAND .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 44900, last4: "731", merchant: "SKYLINE BROADBAND" },
      auto: true,
    },
    {
      name: "credit card spend with a time before the shop",
      text: "HSBC: Thank you for using HSBC Credit Card XXXX4471 for INR 1,346.00 at 19:05 at LOTUS NOODLE BAR on 06-Nov-26.",
      want: { parserId: "hsbc", type: "expense", amountMinor: 134600, last4: "4471", instrument: "card", merchant: "LOTUS NOODLE BAR" },
      auto: true,
    },
    {
      name: "a card spend that was reversed is money back on the card",
      text: "Thank you for using HSBC Credit Card XXXX4471 for INR 2,215.00 at HARBOUR KITCHEN on 06-Nov-26. The transaction has been reversed.",
      want: { parserId: "hsbc", type: "income", amountMinor: 221500, last4: "4471", instrument: "card" },
    },
    {
      name: "a refund credited after a debit card spend is money back",
      text: "HSBC: Thank you for using HSBC Debit Card XXXXX47xx for INR 535.00 on 06-Nov-26 at MAPLE DELI . Refund of INR 535.00 has been credited.",
      want: { parserId: "hsbc", type: "income", amountMinor: 53500, last4: undefined },
    },
    {
      name: "outgoing NEFT that names the person's account keeps it",
      text: "HSBC: Dear HSBC Customer, your NEFT transaction from A/c 118-402***-731 for INR 8,450.00 has been credited to the AXIS A/c XXXXXXXX6634 of SUMAN PILLAI on 06-11-2026 .",
      want: { parserId: "hsbc", type: "expense", amountMinor: 845000, last4: "731", merchant: "SUMAN PILLAI" },
      auto: true,
    },
    {
      name: "a failed NEFT returned to the account is money back, not money out",
      text: "HSBC: Dear HSBC Customer, your NEFT transaction for INR 8,450.00 has failed and the amount has been credited to the A/c 118-402***-731 on 06-11-2026 .",
      want: { parserId: "hsbc", type: "income", amountMinor: 845000, last4: "731" },
    },
    {
      name: "an NEFT that could not be processed and came back to the account is money back",
      text: "HSBC: Dear HSBC Customer, your NEFT transaction for INR 4,215.00 could not be processed and has been credited to the A/c 118-402***-731 on 06-11-2026 .",
      want: { parserId: "hsbc", type: "income", amountMinor: 421500, last4: "731" },
    },
    {
      name: "a cash deposit to the account",
      text: "HSBC: A/c 118-402***-731 is credited with INR 3,500.00 on 06NOV towards cash deposit at CDM SECTOR 29 .",
      want: { parserId: "hsbc", type: "income", amountMinor: 350000, last4: "731" },
      auto: true,
    },
    {
      name: "a payment to the credit card ('creditcard' as one word) is a card bill payment",
      text: "Your HSBC creditcard xxxxx4471 payment of INR 11,350.00 has been received. Thank you.",
      want: { parserId: "hsbc", cardPayment: true, last4: "4471", instrument: "card" },
      auto: false,
    },
    {
      name: "an OTP is ignored",
      text: "HSBC: 583014 is your OTP for a txn of INR 2,140.00 at BOOKNOOK. Do not share it.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
