import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("ICICI Bank parser", () => {
  readsAll({ sender: "AX-ICICIT-S" }, [
    {
      name: "UPI debit: three masked digits, the payee before credited, the UPI ref",
      text: "ICICI Bank Acct XX482 debited for Rs 180.00 on 12-Nov-26; CORNER CAFE credited. UPI:631200001111. Call 1800000000 for dispute. SMS BLOCK 482 to 9000000000.",
      want: { parserId: "icici", type: "expense", amountMinor: 18000, last4: "482", merchant: "CORNER CAFE", ref: "631200001111" },
      auto: true,
    },
    {
      name: "NEFT credit: the payer after Info",
      text: "ICICI Bank Account XX482 credited:Rs. 25,000.00 on 12-Nov-26. Info NEFT-ABCD0123456789-ASHA RAO. Available Balance is Rs. 40,000.00.",
      want: { parserId: "icici", type: "income", amountMinor: 2500000, last4: "482", merchant: "ASHA RAO" },
      auto: true,
    },
    {
      name: "NACH debit: the payee glued to Info",
      text: "ICICI Bank Acc XX482 debited Rs. 12,500.00 on 12-Nov-26 InfoACH*CITY HOME LOANS.Avl Bal Rs. 30,000.00.To dispute call 1800000000 or SMS BLOCK 482 to 9000000000",
      want: { parserId: "icici", type: "expense", amountMinor: 1250000, last4: "482", merchant: "CITY HOME LOANS" },
      auto: true,
    },
    {
      name: "card spend: the shop after the date",
      text: "INR 899.00 spent using ICICI Bank Card XX4821 on 12-Nov-26 on BOOKNOOK. Avl Limit: INR 1,20,000.00. If not you, call 1800000000/SMS BLOCK 4821 to 9000000000.",
      want: { parserId: "icici", type: "expense", amountMinor: 89900, last4: "4821", instrument: "card", merchant: "BOOKNOOK" },
      auto: true,
    },
    {
      name: "card spend abroad keeps its currency and goes to Review",
      text: "USD 20.00 spent using ICICI Bank Card XX4821 on 12-Nov-26 on CLOUDNOTES. Avl Limit: INR 1,20,000.00.",
      want: { parserId: "icici", currency: "USD", amountMinor: 2000, merchant: "CLOUDNOTES" },
      auto: false,
    },
    {
      name: "ATM withdrawal has no merchant",
      text: "ICICI Bank Acc XX482 debited Rs. 3,000.00 on 12-Nov-26 NFSCASH WDL. Avb Bal Rs. 9,000.00. To dispute Call 1800000000 or SMS BLOCK 482 to 9000000000 .",
      want: { parserId: "icici", type: "expense", amountMinor: 300000, last4: "482", atm: true, merchant: undefined },
      auto: true,
    },
    {
      name: "IMPS between two accounts: the payer's account and the IMPS ref",
      text: "ICICI Bank Acct XX482 debited with Rs 750 on 12-Nov-26 & Acct XX913 credited.IMPS:QWER12345678. Call 1800000000 for dispute",
      want: { parserId: "icici", type: "expense", amountMinor: 75000, last4: "482", ref: "QWER12345678" },
    },
    {
      name: "NEFT sent: credited to the beneficiary is money out",
      text: "ICICI BANK NEFT Transaction with reference number AB12345678901234 for Rs. 5000.00 has been credited to the beneficiary account on 12-11-2026 at 10:15:00",
      want: { parserId: "icici", type: "expense", amountMinor: 500000 },
      auto: false,
    },
    {
      name: "card bill payment goes to Review",
      text: "Payment of Rs 8,000.00 has been received on your ICICI Bank Credit Card XX4821 through Bharat Bill Payment System on 12-NOV-26.",
      want: { parserId: "icici", cardPayment: true, last4: "4821" },
      auto: false,
    },
    {
      name: "an AutoPay notice is ignored",
      text: "Your account will be debited with Rs 199.00 on 15-Nov-26 towards StreamCo for AutoPay MERCHANTMANDATE, RRN 631200009999-ICICI Bank.",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
