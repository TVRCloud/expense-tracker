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
    {
      name: "the payee is read only after the reference: no payee, no merchant",
      text: "INR 7,215.00 debited from Equitas-4419 via UPI -Ref:639011220031 on 15-11-26.Bal INR 3,410.00.Not U?SMS BLOCK UPI to 7012345991",
      want: { parserId: "equitas", type: "expense", amountMinor: 721500, last4: "4419", merchant: undefined },
    },
    {
      name: "a payee that is an account is no merchant",
      text: "INR 2,415.00 debited from Equitas-4419 via UPI -Ref:639011220037 to A/c 1234 of RAVI on 15-11-26.Bal INR 995.00",
      want: { parserId: "equitas", type: "expense", amountMinor: 241500, last4: "4419", merchant: undefined },
    },
    {
      name: "a shop whose name starts with Block keeps it",
      text: "INR 215.00 debited from Equitas-4419 via UPI -Ref:639011220032 to BLOCK C STATIONERS on 15-11-26.Bal INR 3,195.00",
      want: { parserId: "equitas", type: "expense", amountMinor: 21500, last4: "4419", merchant: "BLOCK C STATIONERS" },
      auto: true,
    },
    {
      name: "a loan credited by a debit from the account goes to Review on no account",
      text: "INR 3,265.00 credited to Equitas Loan A/c 7788 by debit to Equitas A/c 4419 on 15-11-26",
      want: { parserId: "equitas", amountMinor: 326500, last4: undefined },
      auto: false,
    },
    {
      name: "money into an RD from the account goes to Review",
      text: "Equitas A/c 4419: INR 2,035.00 credited to RD A/c 9922",
      want: { parserId: "equitas", amountMinor: 203500, last4: undefined },
      auto: false,
    },
  ]);
});
