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
  ]);
});
