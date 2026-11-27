import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Punjab & Sind Bank sends.
describe("Punjab & Sind Bank parser", () => {
  readsAll({ sender: "JD-PSBANK-S" }, [
    {
      name: "NEFT credit names the sender in the rail path",
      text: "PSB000000781934520 A/C No **7326 Credited with Rs 1297--NEFT/N308260001122/BLUE RIVER TRADERS (CLR BAL 4410.75CR)(04-11-2026 10:41:22) Punjab&Sind Bank",
      want: { parserId: "psb", type: "income", amountMinor: 129700, last4: "7326", merchant: "BLUE RIVER TRADERS", ref: "N308260001122" },
      auto: true,
    },
    {
      name: "UPI credit names the payer",
      text: "PSB000000781934521 A/c No **7326 Credited with Rs 3360--UPI/CR/631955667701/DEEPA NAIR/SBIN/88880000111122/U (CLR BAL 7852.75CR)(04-11-2026 12:10:09)-Punjab&Sind Bank",
      want: { parserId: "psb", type: "income", amountMinor: 336000, last4: "7326", merchant: "DEEPA NAIR", ref: "631955667701" },
      auto: true,
    },
    {
      name: "UPI debit names the payee",
      text: "PSB000000781934522 A/c No **7326 Debited with Rs 655--UPI/DR/631955667788/GROCERY NOOK/YESB/88880000111122/U (CLR BAL 7239.75CR)(04-11-2026 13:02:45)-Punjab&Sind Bank",
      want: { parserId: "psb", type: "expense", amountMinor: 65500, last4: "7326", merchant: "GROCERY NOOK" },
      auto: true,
    },
    {
      name: "a note after the amount is never a name",
      text: "PSB000000781934523 A/C No **7326 Credited with Rs 437--Vendor Amount (CLR BAL 7627.75CR)(04-11-2026 15:20:11) Punjab&Sind Bank",
      want: { parserId: "psb", type: "income", amountMinor: 43700, last4: "7326", merchant: undefined },
    },
  ]);
});
