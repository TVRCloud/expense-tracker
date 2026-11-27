import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("ICICI Bank parser", () => {
  readsAll({ sender: "AX-ICICIT-S" }, [
    {
      name: "UPI debit: three masked digits, the payee before credited, the UPI ref",
      text: "ICICI Bank Acct XX274 debited for Rs 264.00 on 03-Oct-26; LAKESIDE BAKERY credited. UPI:604400118822. Call 1800333444 for dispute. SMS BLOCK 274 to 9300011122.",
      want: { parserId: "icici", type: "expense", amountMinor: 26400, last4: "274", merchant: "LAKESIDE BAKERY", ref: "604400118822" },
      auto: true,
    },
    {
      name: "a masked account before credited is never the payee",
      text: "ICICI Bank Acct XX274 debited for Rs 905.00 on 03-Oct-26; XX6618 credited. UPI:604400118823.",
      want: { parserId: "icici", type: "expense", amountMinor: 90500, merchant: undefined },
    },
    {
      name: "NEFT credit: the payer after Info",
      text: "ICICI Bank Account XX274 credited:Rs. 31,450.00 on 03-Oct-26. Info NEFT-WXYZ0099887766-MEERA KRISHNAN. Available Balance is Rs. 47,212.80.",
      want: { parserId: "icici", type: "income", amountMinor: 3145000, last4: "274", merchant: "MEERA KRISHNAN" },
      auto: true,
    },
    {
      name: "NACH debit: the payee glued to Info",
      text: "ICICI Bank Acc XX274 debited Rs. 8,775.00 on 03-Oct-26 InfoACH*RIVERSIDE HOUSING FIN.Avl Bal Rs. 22,410.05.To dispute call 1800333444 or SMS BLOCK 274 to 9300011122",
      want: { parserId: "icici", type: "expense", amountMinor: 877500, last4: "274", merchant: "RIVERSIDE HOUSING FIN" },
      auto: true,
    },
    {
      name: "a mandate set-up stays in Review",
      text: "ICICI Bank Acct XX274 credited:Rs. 3.00 on 03-Oct-26. Info NACH*MANDATE REGISTRATION*SETUP. Available Balance is Rs. 9,402.00.",
      want: { kind: "money" },
      auto: false,
    },
    {
      name: "card spend: the shop after the date",
      text: "INR 1,042.00 spent using ICICI Bank Card XX3391 on 03-Oct-26 on QUILL AND INK. Avl Limit: INR 88,415.20. If not you, call 1800333444/SMS BLOCK 3391 to 9300011122.",
      want: { parserId: "icici", type: "expense", amountMinor: 104200, last4: "3391", instrument: "card", merchant: "QUILL AND INK" },
      auto: true,
    },
    {
      name: "card spend abroad keeps its currency and goes to Review",
      text: "USD 14.25 spent using ICICI Bank Card XX3391 on 03-Oct-26 on PIXELNOTE. Avl Limit: INR 88,415.20.",
      want: { parserId: "icici", currency: "USD", amountMinor: 1425, merchant: "PIXELNOTE" },
      auto: false,
    },
    {
      name: "ATM withdrawal has no merchant",
      text: "ICICI Bank Acc XX274 debited Rs. 4,450.00 on 03-Oct-26 NFSCASH WDL. Avb Bal Rs. 6,118.30. To dispute Call 1800333444 or SMS BLOCK 274 to 9300011122 .",
      want: { parserId: "icici", type: "expense", amountMinor: 445000, last4: "274", atm: true, merchant: undefined },
      auto: true,
    },
    {
      name: "ATM withdrawal written after Info is cash too",
      text: "ICICI Bank Acct XX274 debited Rs. 1,550.00 on 03-Oct-26 InfoATM*S1AB0071*WDL. Avl Bal Rs. 2,210.00",
      want: { parserId: "icici", atm: true, merchant: undefined },
    },
    {
      name: "IMPS between two accounts: the payer's account and the IMPS ref",
      text: "ICICI Bank Acct XX274 debited with Rs 1,163 on 03-Oct-26 & Acct XX653 credited.IMPS:ZXCV31415926. Call 1800333444 for dispute",
      want: { parserId: "icici", type: "expense", amountMinor: 116300, last4: "274", ref: "ZXCV31415926" },
    },
    {
      name: "NEFT sent: credited to the beneficiary is money out",
      text: "ICICI BANK NEFT Transaction with reference number WX27182818284590 for Rs. 7300.00 has been credited to the beneficiary account on 03-10-2026 at 08:41:27",
      want: { parserId: "icici", type: "expense", amountMinor: 730000 },
      auto: false,
    },
    {
      name: "card bill payment goes to Review",
      text: "Payment of Rs 12,640.00 has been received on your ICICI Bank Credit Card XX3391 through Bharat Bill Payment System on 03-OCT-26.",
      want: { parserId: "icici", cardPayment: true, last4: "3391" },
      auto: false,
    },
    {
      name: "a UPI payment to a credit card is a card bill payment",
      text: "ICICI Bank Acct XX274 debited for Rs 9,125.00 on 03-Oct-26; ICICI Bank Credit Card XX3391 credited. UPI:604400118899.",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "a card bill paid after Info is a card bill payment",
      text: "ICICI Bank Acct XX274 debited for Rs 11,300.00 on 03-Oct-26 InfoBIL*ICICI Card 3391. Avl Bal Rs 6,000.",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "an AutoPay notice is ignored",
      text: "Your account will be debited with Rs 349.00 on 09-Oct-26 towards TuneBox for AutoPay MERCHANTMANDATE, RRN 604400117777-ICICI Bank.",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
