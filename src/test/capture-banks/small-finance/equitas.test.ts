import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape Equitas Small Finance Bank sends.
describe("Equitas Small Finance Bank parser", () => {
  readsAll({ sender: "CP-EQUTAS-S" }, [
    {
      name: "UPI debit names the account with plain digits",
      text: "INR 1,480.00 debited via UPI from Equitas A/c 7302 -Ref:638244550011 on 14-11-26 to GREEN BASKET. Avl Bal is INR 6,215.40.Not U?Call 1800xxxx",
      want: { parserId: "equitas", type: "expense", amountMinor: 148000, last4: "7302", merchant: "GREEN BASKET", ref: "638244550011", balanceMinor: 621540 },
      auto: true,
    },
    {
      name: "short UPI debit written Equitas-1234",
      text: "INR 653.00 debited from Equitas-7302 via UPI -Ref:638244550012 to SUNRISE TAILORS on 14-11-26.Bal INR 5,575.40.Not U?SMS BLOCK UPI to 70xxxxx",
      want: { parserId: "equitas", type: "expense", amountMinor: 65300, last4: "7302", merchant: "SUNRISE TAILORS" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "INR 3,100.00 credited via UPI to Equitas A/c 7302 -Ref:638244550013 on 14-11-26 from KAVYA ROY. Avl Bal is INR 8,675.40.Not U?Call 1800xxxx",
      source: { sender: "AX-EQUITA-S" },
      want: { parserId: "equitas", type: "income", amountMinor: 310000, last4: "7302", merchant: "KAVYA ROY" },
      auto: true,
    },
  ]);
});
