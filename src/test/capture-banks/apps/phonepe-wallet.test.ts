import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shape the PhonePe wallet sends (fake amounts, numbers and names).
describe("PhonePe wallet parser", () => {
  readsAll({ sender: "JD-PHONPE-S" }, [
    {
      name: "a payment from the wallet names the shop and stays in Review (no account)",
      text: "You've paid Rs.48.70 via PhonePe wallet for GREEN BASKET MART. Not you? Call us on 080-46317720. Remaining balance: Rs.211.30. To top-up click https://example.com/w",
      want: { parserId: "phonepe_wallet", type: "expense", amountMinor: 4870, merchant: "GREEN BASKET MART", last4: undefined },
      auto: false,
    },
    {
      name: "a shop named with an income word is still a payment",
      text: "You've paid Rs.95.00 via PhonePe wallet for TAKEOUT REFUND HUB. Not you? Call us on 080-46317720. Remaining balance: Rs.13.85.",
      want: { parserId: "phonepe_wallet", type: "expense", amountMinor: 9500, merchant: "TAKEOUT REFUND HUB" },
      auto: false,
    },
    {
      name: "money added to the wallet is income in Review",
      text: "Rs.300 has been added to your PhonePe wallet on 12-11-26. Remaining balance: Rs.312.00.",
      want: { parserId: "phonepe_wallet", type: "income", amountMinor: 30000, last4: undefined },
      auto: false,
    },
    {
      name: "a UPI payment from the bank is left to the generic parser (the bank's own message records it)",
      text: "You've sent ₹175.40 to CORNER CAFE from your bank account using UPI.",
      want: { parserId: "generic", type: "expense", amountMinor: 17540 },
      auto: false,
    },
    {
      name: "a PhonePe app notification is not claimed (only the PHONPE SMS header is)",
      text: "You've paid ₹62 via PhonePe wallet for CITY METRO CARD. Remaining balance: ₹18.",
      source: { sender: "PhonePe", packageName: "com.phonepe.app" },
      want: { parserId: "generic", type: "expense", amountMinor: 6200 },
      auto: false,
    },
  ]);
});
