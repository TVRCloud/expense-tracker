import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Union Bank of India sends.
describe("Union Bank of India parser", () => {
  readsAll({ sender: "JM-UNIONB-S" }, [
    {
      name: "mobile banking debit names the payee after the transfer number, and never keeps that number",
      text: "Union Bank of India A/c*5093 Dr Rs214.00 on 04-11-26 13:43 by MB 6601234567 NAVKAR MEDICALS, Bal Rs3,105.80 Not U?Call 18001234/SMS BLOCK 5093 to 9811100000",
      want: { parserId: "union", type: "expense", amountMinor: 21400, last4: "5093", merchant: "NAVKAR MEDICALS", ref: undefined, balanceMinor: 310580 },
      auto: true,
    },
    {
      name: "mobile banking credit",
      text: "Union Bank of India A/c*5093 Cr Rs1,180.00 on 04-11-26 10:07 by MB 6601234678 FARHAN ALI, Bal Rs4,285.80 Not U?Call 18001234",
      want: { parserId: "union", type: "income", amountMinor: 118000, last4: "5093", merchant: "FARHAN ALI" },
      auto: true,
    },
    {
      name: "an amount after a colon",
      text: "A/c *5093 Debited for Rs:740.00 on 04-11-2026 18:02:11 by Mob Bk ref no 631911223344 Avl Bal Rs:2,365.80",
      want: { parserId: "union", type: "expense", amountMinor: 74000, last4: "5093", merchant: undefined, ref: "631911223344", balanceMinor: 236580 },
      auto: true,
    },
    {
      name: "an offer is ignored",
      text: "Get 15% cashback offer on Union Bank Debit Card. Shop for Rs 750 or more. T&C apply.",
      want: { kind: "ignored", reason: "promo" },
    },
  ]);
});
