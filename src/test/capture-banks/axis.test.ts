import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("Axis Bank parser", () => {
  readsAll({ sender: "AX-AXISBK-S" }, [
    {
      name: "card spend with the shop between the time and the limit",
      text: "Spent INR 450 Axis Bank Card no. XX4821 12-11-26 13:05:44 IST CHAI POINT Avl Limit: INR 80000.00 Not you? SMS BLOCK 4821 to 910000000000",
      want: { parserId: "axis", type: "expense", amountMinor: 45000, last4: "4821", instrument: "card", merchant: "CHAI POINT" },
      auto: true,
    },
    {
      name: "card spend, card first",
      text: "Spent Card no. XX4821 INR 300 12-11-26 18:40:02 FRESHMART Avl Lmt INR 79700.00 SMS BLOCK 4821 to 910000000000, if not you - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 30000, last4: "4821", merchant: "FRESHMART" },
      auto: true,
    },
    {
      name: "credit card spend with at",
      text: "Spent INR 623 using Axis Bank Credit Card no. XX4821 on 12-11-26 17:31:29 IST at SWIGGY FOOD. Avl limit: INR 50376.49. Not you? SMS BLOCK 4821 to +910000000000.",
      want: { parserId: "axis", type: "expense", amountMinor: 62300, last4: "4821", merchant: "SWIGGY FOOD" },
      auto: true,
    },
    {
      name: "debit: the account's last four, never the BLOCKCARD digits",
      text: "INR 1200.00 debited from A/c no. XX774821 on BOOKNOOK 12-11-2026 16:06:39 IST. Avl bal: INR 9000.00. Not you? SMS BLOCKCARD XX9911 to +910000000000 - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 120000, last4: "4821", instrument: "account", merchant: "BOOKNOOK" },
      auto: true,
    },
    {
      name: "a fully masked account has no digits and goes to Review",
      text: "INR 209.00 debited from A/c no. XXxxxx on CAFE ONE 12-11-2026 13:13:27 IST. Avl bal: INR xxxxx. Not you? SMS BLOCKCARD XX9911 to +910000000000 - Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 20900, last4: undefined, merchant: "CAFE ONE" },
      auto: false,
    },
    {
      name: "UPI debit: payee and ref from the UPI path",
      text: "INR 250.00 debited A/c no. XX774821 12-11-26 10:15:00 UPI/P2M/631233334444/RAJ STORES Not you? SMS BLOCKUPI Cust ID to 910000000000 Axis Bank",
      want: { parserId: "axis", type: "expense", amountMinor: 25000, last4: "4821", merchant: "RAJ STORES", ref: "631233334444" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "INR 1000.00 credited to A/c no. XX774821 on 12-11-26 at 10:15:00 IST. Info- UPI/P2A/631255556666/ASHA RAO/HDFC BANK. - Axis Bank",
      want: { parserId: "axis", type: "income", amountMinor: 100000, last4: "4821", merchant: "ASHA RAO", ref: "631255556666" },
      auto: true,
    },
    {
      name: "a due notice is ignored",
      text: "Your Axis Bank Credit Card XX4821 bill of INR 12,000.00 is due on 20-11-26. Minimum amount due INR 600.00.",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
