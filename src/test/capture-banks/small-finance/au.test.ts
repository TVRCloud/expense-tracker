import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape AU Small Finance Bank sends.
describe("AU Small Finance Bank parser", () => {
  readsAll({ sender: "VM-AUBANK-S" }, [
    {
      name: "UPI debit with the payee in the UPI path",
      text: "Debited INR 342.50 from A/c X6083 on 14-NOV-2026\nUPI/DR/638211907745/RIVERSIDE CAFE/HDFC/50100\nBal INR 12,406.75\n-AU Bank",
      want: { parserId: "au", type: "expense", amountMinor: 34250, last4: "6083", merchant: "RIVERSIDE CAFE", ref: "638211907745", balanceMinor: 1240675 },
      auto: true,
    },
    {
      name: "short UPI debit never takes the help line's number as the payee",
      text: "Dr INR 1,150.00 - AU A/c X2918 14-NOV-2026\nUPI/DR/638211907746/MEERA STORES/Y\nBal INR 4,830.20\nFraud? Call 18001xxxx/SMS BLOCK UPI to 56xxxxx",
      want: { parserId: "au", type: "expense", amountMinor: 115000, last4: "2918", merchant: "MEERA STORES" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "Cr INR 7,465.00 to A/c X2918 14-NOV-2026\nUPI/CR/638211907747/ANIL VERMA/Y\nBal INR 12,330.20\n-AU Bank",
      want: { parserId: "au", type: "income", amountMinor: 746500, last4: "2918", merchant: "ANIL VERMA", ref: "638211907747" },
      auto: true,
    },
    {
      name: "a UPI path naming a bank account gives no merchant",
      text: "Dr INR 2,900.00 from A/c X2918 on 14-NOV-2026\nUPI/DR/638211907748/Bank Account XXXXX\nBal INR 1,930.20\n-AU Bank",
      want: { parserId: "au", type: "expense", amountMinor: 290000, last4: "2918", merchant: undefined },
    },
    {
      name: "credit card spend",
      text: "INR 618.40 spent at CLOUDNOTE APP on AU Bank Credit Card x5527 14-11-2026 07:12:09 PM. Not you? Call 1800xxxx or SMS PBLOCK 5527 to 56xxxxx",
      want: { parserId: "au", type: "expense", amountMinor: 61840, last4: "5527", instrument: "card", merchant: "CLOUDNOTE APP" },
      auto: true,
    },
    {
      name: "a reference written with a D before its digits keeps the digits only",
      text: "Debited INR 87.65 from A/c X6083 on 14-NOV-2026\nUPI/DR/D638211907749/PAAN CORNER/YESB/40011\nBal INR 12,318.55\n-AU Bank",
      want: { parserId: "au", type: "expense", amountMinor: 8765, merchant: "PAAN CORNER", ref: "638211907749" },
      auto: true,
    },
    {
      name: "card spend abroad stays in Review",
      text: "USD 14.25 spent at TYPEFORGE on AU Bank Credit Card x5527 14-11-2026 06:40:12 AM. Not you? Call 1800xxxx",
      want: { parserId: "au", type: "expense", amountMinor: 1425, currency: "USD", last4: "5527" },
      auto: false,
    },
  ]);
});
