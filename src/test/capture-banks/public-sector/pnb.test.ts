import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape PNB sends.
describe("Punjab National Bank parser", () => {
  readsAll({ sender: "VM-PNBSMS-S" }, [
    {
      name: "account debit with the balance",
      text: "Ac XX6731 Debited with Rs.1,845.00, 04-11-2026 09:12:47. Aval Bal Rs.12,630.25 CR. Helpline 18001234-PNB",
      want: { parserId: "pnb", type: "expense", amountMinor: 184500, last4: "6731", balanceMinor: 1263025 },
      auto: true,
    },
    {
      name: "UPI debit drops the trailing 'thru'",
      text: "A/c X6731 debited INR 94.00 Dt 04-11-26 08:40:12 to Chai Point thru UPI:631845002917.Bal INR 12,534.25-PNB",
      want: { parserId: "pnb", type: "expense", amountMinor: 9400, last4: "6731", merchant: "Chai Point", ref: "631845002917" },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "Ac XX6731 Credited with Rs.3,260.00 04-11-2026 11:02:09 thru UPI . Aval Bal Rs.15,794.25 CR. (UPI Ref ID:631845003048) Helpline 18001234-PNB",
      want: { parserId: "pnb", type: "income", amountMinor: 326000, last4: "6731", ref: "631845003048" },
      auto: true,
    },
    {
      name: "a transfer naming two accounts is booked on the payer's",
      text: "Your a/c no XX6731 is debited for Rs 2715 on 04-11-26 10:22:31 and a/c XX5582 credited (IMPS Ref no 631845004155) . Not done by you? Report it to the bank at once.",
      want: { parserId: "pnb", type: "expense", amountMinor: 271500, last4: "6731", merchant: undefined },
      auto: true,
    },
    {
      name: "credit card spend through UPI names the card",
      text: "PNB Credit Card 4419 debited with Rs.612 at grocer.hub@ybl on 04-11-2026 19:17 through UPI: 631845005262 Avl limit Rs. 37,118.50. -PNB",
      source: { sender: "VM-PNBCCD-S" },
      want: { parserId: "pnb", type: "expense", amountMinor: 61200, last4: "4419", instrument: "card", merchant: "grocer.hub@ybl", availableLimitMinor: 3711850 },
      auto: true,
    },
    {
      name: "cash from a PNB ATM",
      text: "A/c XX6731 debited with Rs.4,350.00, 04-11-2026 18:01:33 thru card XX5108 at PNB ATM. Bal 11,794.25 CR -PNB",
      want: { parserId: "pnb", type: "expense", amountMinor: 435000, last4: "6731", atm: true, merchant: undefined },
    },
  ]);
});
