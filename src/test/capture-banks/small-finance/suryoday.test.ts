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
  ]);
});
