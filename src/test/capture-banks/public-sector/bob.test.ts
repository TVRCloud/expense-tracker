import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Bank of Baroda sends.
describe("Bank of Baroda parser", () => {
  readsAll({ sender: "AD-BOBTXN-S" }, [
    {
      name: "'Dr.' after the amount is a debit; six account digits give the last four",
      text: "Rs.318.00 Dr. from A/c XX719628 on 04-11-2026. AvlBal:Rs8,897.40. Ref:631902114488 -Bank of Baroda",
      want: { parserId: "bob", type: "expense", amountMinor: 31800, last4: "9628", ref: "631902114488" },
      auto: true,
    },
    {
      name: "'Cr.' after the amount is a credit from that UPI id",
      text: "Rs.1,297.00 Cr. to anita.p@okicici A/c XX719628 on 04-11-2026. AvlBal:Rs10,147.40. Ref:631902114599 -Bank of Baroda",
      want: { parserId: "bob", type: "income", amountMinor: 129700, last4: "9628", merchant: "anita.p@okicici" },
      auto: true,
    },
    {
      name: "a transfer with a dotted account mask",
      text: "Rs.655.00 transferred from A/c ...7193 to:SHARMA TRADERS. Total Bal:Rs.9,215.40CR. Avlbl Amt:Rs.9,215.40(04-11-2026 14:21:08) - Bank of Baroda",
      source: { sender: "AD-BOBSMS-S" },
      want: { parserId: "bob", type: "expense", amountMinor: 65500, last4: "7193", merchant: "SHARMA TRADERS" },
      auto: true,
    },
    {
      name: "IMPS credit names the payer",
      text: "Rs.7,450.00 credited to A/c XX719628 via IMPS/631902114610 by MEERA JOSHI. AvlBal:Rs17,647.40 -Bank of Baroda",
      want: { parserId: "bob", type: "income", amountMinor: 745000, last4: "9628", merchant: "MEERA JOSHI", ref: "631902114610" },
      auto: true,
    },
    {
      name: "cash deposit has no merchant",
      text: "Rs.6,350.00 deposited in cash to A/c XX719628 on 04-11-2026. AvlBal:Rs23,647.40 -Bank of Baroda",
      want: { parserId: "bob", type: "income", amountMinor: 635000, last4: "9628", merchant: undefined },
    },
    {
      name: "BOBCARD spend",
      text: "ALERT: INR 2,315.75 is spent on your BOBCARD ending 3381 at CROMA ONLINE on 04-11-2026 16:44:10. Available credit limit is Rs 58,410.25 -Bank of Baroda",
      source: { sender: "AD-BOBCRD-S" },
      want: { parserId: "bob", type: "expense", amountMinor: 231575, last4: "3381", instrument: "card", merchant: "CROMA ONLINE" },
      auto: true,
    },
  ]);
});
