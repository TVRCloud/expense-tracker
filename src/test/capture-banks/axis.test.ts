import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("Axis Bank parser", () => {
  readsAll({ sender: "AX-AXISBK-S" }, [
    {
      name: "card spend with the shop between the time and the limit",
      text: "Spent INR 75 Axis Bank Card no. XX2208 03-10-26 08:12:40 IST HILLTOP CHAI Avl Limit: INR 61420.15 Not you? SMS BLOCK 2208 to 919800011122",
      want: { parserId: "axis", type: "expense", amountMinor: 7500, last4: "2208", instrument: "card", merchant: "HILLTOP CHAI" },
      auto: true,
    },
    {
      name: "card spend with no shop has no merchant",
      text: "Spent INR 38 Axis Bank Card no. XX2208 03-10-26 08:20:11 IST Avl Limit: INR 61382.15",
      want: { parserId: "axis", merchant: undefined },
    },
    {
      name: "card spend, card first",
      text: "Spent Card no. XX2208 INR 415 03-10-26 19:48:31 GREENBASKET Avl Lmt INR 60972.15 SMS BLOCK 2208 to 919800011122, if not you - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 41500, last4: "2208", merchant: "GREENBASKET" },
      auto: true,
    },
    {
      name: "credit card spend with at",
      text: "Spent INR 1,086 using Axis Bank Credit Card no. XX2208 on 03-10-26 20:04:52 IST at PIZZA LANE. Avl limit: INR 59886.15. Not you? SMS BLOCK 2208 to +919800011122.",
      want: { parserId: "axis", type: "expense", amountMinor: 108600, last4: "2208", merchant: "PIZZA LANE" },
      auto: true,
    },
    {
      name: "debit: the account's last four, never the BLOCKCARD digits",
      text: "INR 2,940.00 debited from A/c no. XX550917 on QUILL AND INK 03-10-2026 15:27:06 IST. Avl bal: INR 14,005.00. Not you? SMS BLOCKCARD XX3302 to +919800011122 - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 294000, last4: "0917", instrument: "account", merchant: "QUILL AND INK" },
      auto: true,
    },
    {
      name: "a fully masked account has no digits and goes to Review",
      text: "INR 330.00 debited from A/c no. XXxxxxz on CAFE MOSAIC 03-10-2026 11:46:52 IST. Avl bal: INR xxxxxx. Not you? SMS BLOCKCARD XX3302 to +919800011122 - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 33000, last4: undefined, merchant: "CAFE MOSAIC" },
      auto: false,
    },
    {
      name: "a debit for a credit card bill is a card bill payment",
      text: "INR 9,450.00 debited from A/c no. XX550917 on CREDIT CARD BILL PAYMENT 03-10-2026 10:02:44 IST. Avl bal: INR 4,555.00 - Axis Bank",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "UPI debit: payee and ref from the UPI path",
      text: "INR 97.00 debited A/c no. XX550917 03-10-26 09:31:18 UPI/P2M/604477778888/NEELAM STORES Not you? SMS BLOCKUPI Cust ID to 919800011122 Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 9700, last4: "0917", merchant: "NEELAM STORES", ref: "604477778888" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "INR 2,600.00 credited to A/c no. XX550917 on 03-10-26 at 12:15:40 IST. Info- UPI/P2A/604477779999/MEERA K/SBI. - Axis Bank",
      want: { parserId: "axis", type: "income", amountMinor: 260000, last4: "0917", merchant: "MEERA K", ref: "604477779999" },
      auto: true,
    },
    {
      name: "NEFT credit: the payer after Info",
      text: "INR 7,035.00 credited to A/c no. XX550917 on 03-10-26 at 10:00:12 IST. Info- NEFT/WXYZ88771/RAVI MENON. - Axis Bank",
      want: { parserId: "axis", type: "income", merchant: "RAVI MENON" },
    },
    {
      name: "ATM withdrawal has no shop",
      text: "INR 3,050.00 debited from A/c no. XX550917 on ATM CASH WDL 03-10-2026 10:37:14 IST. Avl bal: INR 1,555.00 - Axis Bank",
      want: { parserId: "axis", atm: true, merchant: undefined },
    },
    {
      name: "a due notice is ignored",
      text: "Your Axis Bank Credit Card XX2208 bill of INR 18,240.00 is due on 21-10-26. Minimum amount due INR 912.00.",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
