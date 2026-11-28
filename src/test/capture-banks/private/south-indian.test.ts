import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shape South Indian Bank sends.
describe("South Indian Bank parser", () => {
  readsAll({ sender: "AD-SIBSMS-S" }, [
    {
      name: "UPI debit written 'UPI debit:Rs.'",
      text: "UPI debit:Rs.437.00 A/c X6152, 04-10-26 18:42:07 RRN: 604377015566 Bal:Rs.7,214.30 Block A/c? Call 0000000000/SMS BLK<A/c>to 0000000000-South Indian Bank",
      want: { parserId: "south_indian", type: "expense", amountMinor: 43700, last4: "6152", ref: "604377015566", balanceMinor: 721430 },
      auto: true,
    },
    {
      name: "card or POS debit names the shop before MCT",
      text: "A/c X6152 DEBIT:Rs.1,315.60 HILLTOP DINER MCT Bal:Rs.5,898.70 Block A/c? call 0000000000/SMS BLK<full A/c>to 0000000000-South Indian Bank",
      want: { parserId: "south_indian", type: "expense", amountMinor: 131560, last4: "6152", merchant: "HILLTOP DINER", balanceMinor: 589870 },
      auto: true,
    },
    {
      name: "UPI credit names the payer in the Info field",
      text: "UPI Credit:INR Rs.2,600.00 in A/c X6152. Info: UPI/HDFC/604377017788/ Priya Menon on 04-10-26 20:11:45.Final balance is Rs.8,498.70 -South Indian Bank",
      want: { parserId: "south_indian", type: "income", amountMinor: 260000, last4: "6152", merchant: "Priya Menon", ref: "604377017788" },
      auto: true,
    },
    {
      name: "IMPS credit",
      text: "Dear Customer, Your A/c X6152 is credited with Rs.565.00 Info: IMPS/SBIN/604377019900/ COASTAL TRADERS. Final balance is Rs.9,038.70-South Indian Bank",
      want: { parserId: "south_indian", type: "income", amountMinor: 56500, last4: "6152", merchant: "COASTAL TRADERS", ref: "604377019900" },
      auto: true,
    },
  ]);
});
