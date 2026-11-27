import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape Suryoday Small Finance Bank's credit card sends.
describe("Suryoday Small Finance Bank parser", () => {
  readsAll({ sender: "JM-SSFBNK-T" }, [
    {
      name: "card spend: card digits after CC, limit after Avlb, no shop",
      text: "Rs 845.00 spent on Suryoday SFB CC 3906 on 14-11-2026 at 18:22:41. Avlb Rs 52,140.30 Not you SMS BLOCK CC 3906 to 90000xxxxx. Convert to EMI? visit: https://example.com/emi SSFBNK-T",
      want: { parserId: "suryoday", type: "expense", amountMinor: 84500, last4: "3906", instrument: "card", merchant: undefined, availableLimitMinor: 5214030 },
      auto: true,
    },
    {
      name: "a co-branded card name before the bank",
      text: "Rs 1,207.60 spent on Harbor Coin Suryoday SFB CC 3906 on 14-11-2026 at 09:41:02. Avlb Rs 50,932.70 Not you SMS BLOCK CC 3906 to 90000xxxxx. SSFBNK-T",
      want: { parserId: "suryoday", type: "expense", amountMinor: 120760, last4: "3906", merchant: undefined, availableLimitMinor: 5093270 },
      auto: true,
    },
    {
      name: "a card OTP stays ignored",
      text: "882641 is the OTP for your Suryoday SFB CC 3906 transaction of Rs 845.00. Do not share it with anyone. SSFBNK-T",
      want: { kind: "ignored", reason: "otp" },
    },
    {
      name: "bill paid from a bank account is a card payment on the card",
      text: "Rs 5,035.00 debited from your Suryoday SFB A/c XX5581 towards Suryoday SFB CC 3906 on 15-11-2026",
      want: { parserId: "suryoday", cardPayment: true, last4: "3906", instrument: "card", amountMinor: 503500 },
      auto: false,
    },
    {
      name: "bill paid towards the card is a card payment",
      text: "Rs 5,035.00 paid towards Suryoday SFB CC 3906 on 15-11-2026. Avlb Rs 57,175.30",
      want: { parserId: "suryoday", cardPayment: true, last4: "3906", amountMinor: 503500 },
      auto: false,
    },
    {
      name: "money credited to the card is a card payment",
      text: "Rs 5,035.00 credited to Suryoday SFB CC 3906 on 15-11-2026",
      want: { parserId: "suryoday", cardPayment: true, last4: "3906" },
      auto: false,
    },
    {
      name: "a spend abroad reads its own amount, never the limit",
      text: "USD 12.35 spent on Suryoday SFB CC 3906 on 15-11-2026 at 18:02:11. Avlb Rs 30,127.60",
      want: { parserId: "suryoday", type: "expense", amountMinor: 1235, currency: "USD", last4: "3906" },
      auto: false,
    },
    {
      name: "a spend in euro also reads its own amount",
      text: "EUR 9.35 spent on Suryoday SFB CC 3906 on 15-11-2026 at 18:04:40. Avlb Rs 30,118.25",
      want: { parserId: "suryoday", amountMinor: 935, currency: "EUR" },
      auto: false,
    },
  ]);
});
