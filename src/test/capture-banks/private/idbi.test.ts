import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shape IDBI Bank sends.
describe("IDBI Bank parser", () => {
  readsAll({ sender: "AD-IDBIBK-S" }, [
    {
      name: "UPI debit names the payee between the balance and 'credited'",
      text: "IDBI Bank Acct XX6152 debited for Rs 274.00 on 04-Oct-26; Bal Rs 6,180.55 LAKEVIEW TIFFINS credited. UPI:604377007788. To Block UPI send SMS UPIBLOCK <Mob. No> to 0000000000-IDBI Bank",
      want: { parserId: "idbi", type: "expense", amountMinor: 27400, last4: "6152", merchant: "LAKEVIEW TIFFINS", ref: "604377007788", balanceMinor: 618055 },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "Dear Customer, Acct XX6152 is credited with Rs 1,850.00 on 04-Oct-26 from RAHUL VERMA. UPI:604377009900 Avl Bal Rs 8,030.55-IDBI Bank",
      want: { parserId: "idbi", type: "income", amountMinor: 185000, last4: "6152", merchant: "RAHUL VERMA", ref: "604377009900", balanceMinor: 803055 },
      auto: true,
    },
    {
      name: "AutoPay debit with no account goes to Review",
      text: "Your account has been successfully debited with Rs 129.00 towards CloudNotes for AutoPay",
      want: { parserId: "idbi", type: "expense", amountMinor: 12900, merchant: "CloudNotes" },
      auto: false,
    },
  ]);
});
