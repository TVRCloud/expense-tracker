import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("IDFC FIRST Bank parser", () => {
  readsAll({ sender: "BM-IDFCFB-S" }, [
    {
      name: "UPI debit: the payee before credited",
      text: "Your A/c XX4821 debited by Rs. 1,172.06 on 12/11/26; REDLINE TRAVELS credited. RRN 631200007777. Available balance Rs. 9,000.00. Team IDFC FIRST Bank",
      want: { parserId: "idfc", type: "expense", amountMinor: 117206, last4: "4821", merchant: "REDLINE TRAVELS", ref: "631200007777" },
      auto: true,
    },
    {
      name: "account credit",
      text: "Your A/C XXXXXXX4821 is credited by INR 500.00 on 12/11/26 17:36. New Bal :INR 10000.00",
      want: { parserId: "idfc", type: "income", amountMinor: 50000, last4: "4821" },
      auto: true,
    },
    {
      name: "account debit",
      text: "Your A/C XXXXXXX4821 is debited by INR 68.00 on 12/11/26 17:36. New Bal :INR 5000.00",
      want: { parserId: "idfc", type: "expense", amountMinor: 6800, last4: "4821" },
      auto: true,
    },
    {
      name: "the Happy Shopping card spend keeps its exact format",
      text: "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card ending XX4821 at BOOKNOOK on 12 NOV 2026 at 04:04 PM",
      want: { parserId: "idfc_card_spend", type: "expense", amountMinor: 89615, last4: "4821", merchant: "BOOKNOOK" },
      auto: true,
    },
    {
      name: "card spend abroad goes to Review",
      text: "Transaction Successful! USD 20.00 spent on your IDFC FIRST Bank Credit Card ending XX4821 at CLOUDNOTES on 12-NOV-2026 at 01:28 PM Avbl Limit: INR 4000.00",
      want: { parserId: "idfc", currency: "USD", amountMinor: 2000, merchant: "CLOUDNOTES" },
      auto: false,
    },
    {
      name: "an offer is ignored",
      text: "IDFC FIRST Bank: Get 10% cashback offer on all online purchases this week!",
      want: { kind: "ignored", reason: "promo" },
    },
  ]);
});
