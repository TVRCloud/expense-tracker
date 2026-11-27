import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 174: invented messages in American Express India's shapes. The card prints five digits; the last four count.
describe("American Express parser", () => {
  readsAll({ sender: "AD-AMEXIN-S" }, [
    {
      name: "card spend",
      text: "Alert: You've spent INR 2,345.60 on your AMEX card ** 45832 at BLUE TOKAI on 14 October 2026 at 07:46 PM IST.",
      want: { parserId: "amex", type: "expense", amountMinor: 234560, last4: "5832", instrument: "card", merchant: "BLUE TOKAI" },
      auto: true,
    },
    {
      name: "a spend abroad stays in Review",
      text: "Alert: You've spent USD 18.40 on your AMEX card ** 45832 at CLOUDNOTE on 14 October 2026 at 07:46 PM IST.",
      want: { parserId: "amex", type: "expense", currency: "USD", last4: "5832" },
      auto: false,
    },
    {
      name: "a payment towards the card is a card bill payment",
      text: "We have received a payment of INR 18,000.00 towards your AMEX card ** 45832 on 14 October 2026. Thank you.",
      want: { parserId: "amex", cardPayment: true, last4: "5832", instrument: "card" },
      auto: false,
    },
    {
      name: "a payment written with the full name and 'ending' is a card bill payment",
      text: "Your payment of INR 21,750.00 towards your American Express Card ending 45832 has been received. Thank you.",
      want: { parserId: "amex", cardPayment: true, last4: "5832", instrument: "card" },
      auto: false,
    },
    {
      name: "a second card spend",
      text: "Alert: You've spent INR 689.00 on your AMEX card ** 45832 at METRO BOOKS on 15 October 2026 at 01:12 PM IST.",
      want: { parserId: "amex", type: "expense", amountMinor: 68900, last4: "5832", merchant: "METRO BOOKS" },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "Your American Express one-time code is 814205 for INR 4,120.00 at TRAVELNEST. Do not share it.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
