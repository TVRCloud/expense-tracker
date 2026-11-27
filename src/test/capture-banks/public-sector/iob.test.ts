import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: Indian Overseas Bank only names the bank; the shared rules read the message and it earns no bonus.
describe("Indian Overseas Bank parser", () => {
  readsAll({ sender: "VM-IOBCHN-S" }, [
    {
      name: "a plain debit is read by the shared rules under the bank's name",
      text: "Your a/c no. XXXXX4417 is debited for Rs.865.00 on 04-11-26 by UPI ref 631966778899. -IOB",
      want: { parserId: "iob", bankName: "Indian Overseas Bank", type: "expense", amountMinor: 86500, last4: "4417" },
    },
    {
      name: "a credit through UPI",
      text: "Your a/c no. XXXXX4417 is credited by Rs.2,135.00 on 04-11-26 from meena.k@okhdfcbank (UPI Ref no 631966778901). -IOB",
      want: { parserId: "iob", type: "income", amountMinor: 213500, last4: "4417", merchant: "meena.k@okhdfcbank" },
    },
    {
      name: "cash from an ATM has no merchant",
      text: "Rs.2,600.00 withdrawn from your a/c XXXXX4417 at IOB ATM ADYAR on 04-11-26. Avl Bal Rs.11,248.60 -IOB",
      want: { parserId: "iob", type: "expense", amountMinor: 260000, last4: "4417", atm: true, merchant: undefined },
    },
    {
      name: "no bonus: the score matches the generic parser's",
      text: "Rs.355.00 debited from your a/c XXXXX4417 to VPA juice.corner@ybl on 04-11-26. -IOB",
      want: { parserId: "iob", type: "expense", amountMinor: 35500, last4: "4417", merchant: "juice.corner@ybl" },
    },
    {
      name: "a reversed debit stays in Review",
      text: "Rs.610.00 debited from your a/c XXXXX4417 on 04-11-26 has been reversed. -IOB",
      want: { parserId: "iob", amountMinor: 61000 },
      auto: false,
    },
  ]);
});
