import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("IDFC FIRST Bank parser", () => {
  readsAll({ sender: "BM-IDFCFB-S" }, [
    {
      name: "UPI debit: the payee before credited",
      text: "Your A/c XX9283 debited by Rs. 312.40 on 03/10/26; MOONBEAM TOURS credited. RRN 604499991111. Available balance Rs. 4,016.85. Team IDFC FIRST Bank",
      want: { parserId: "idfc", type: "expense", amountMinor: 31240, last4: "9283", merchant: "MOONBEAM TOURS", ref: "604499991111" },
      auto: true,
    },
    {
      name: "account credit",
      text: "Your A/C XXXXX9283 is credited by INR 2,750.00 on 03/10/26 09:12. New Bal :INR 6,766.85",
      want: { parserId: "idfc", type: "income", amountMinor: 275000, last4: "9283" },
      auto: true,
    },
    {
      name: "account debit",
      text: "Your A/C XXXXX9283 is debited by INR 129.00 on 03/10/26 21:48. New Bal :INR 6,637.85",
      want: { parserId: "idfc", type: "expense", amountMinor: 12900, last4: "9283" },
      auto: true,
    },
    {
      name: "a debit towards a credit card bill is a card bill payment",
      text: "Your A/C XXXXX9283 is debited by INR 4,115.00 on 03/10/26 towards credit card bill. New Bal :INR 2,537.85",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "the Happy Shopping card spend keeps its exact format",
      text: "Happy Shopping! INR 1,377.90 spent on your IDFC FIRST Bank Credit Card ending XX9283 at PAPERLEAF on 03 OCT 2026 at 06:41 PM",
      want: { parserId: "idfc_card_spend", type: "expense", amountMinor: 137790, last4: "9283", merchant: "PAPERLEAF" },
      auto: true,
    },
    {
      name: "card spend abroad goes to Review",
      text: "Transaction Successful! USD 8.40 spent on your IDFC FIRST Bank Credit Card ending XX9283 at PIXELNOTE on 03-OCT-2026 at 11:05 AM Avbl Limit: INR 52,300.10",
      want: { parserId: "idfc", currency: "USD", amountMinor: 840, merchant: "PIXELNOTE" },
      auto: false,
    },
    {
      name: "a promotion is ignored",
      text: "IDFC FIRST Bank: Upgrade to our new travel card and win lounge passes. Apply now!",
      want: { kind: "ignored", reason: "promo" },
    },
  ]);
});
