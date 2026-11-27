import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("Kotak Mahindra Bank parser", () => {
  readsAll({ sender: "JD-KOTAKB-S" }, [
    {
      name: "UPI debit to a UPI id made of digits",
      text: "Sent Rs.186.00 from Kotak Bank AC X6047 to 9700044455@ybl on 03-10-26.UPI Ref 604488881111. Not you, https://example.com",
      want: { parserId: "kotak", type: "expense", amountMinor: 18600, last4: "6047", merchant: "9700044455@ybl", ref: "604488881111" },
      auto: true,
    },
    {
      name: "UPI credit from a UPI id",
      text: "Received Rs.1,420.00 in your Kotak Bank AC X6047 from ravi.m@okaxis on 03-10-26.UPI Ref 604488882222.",
      want: { parserId: "kotak", type: "income", amountMinor: 142000, last4: "6047", merchant: "ravi.m@okaxis" },
      auto: true,
    },
    {
      name: "UPI debit to a name",
      text: "Sent Rs.73.00 from XXXXXX6047 to SUNITA DEVI on 03/10/2026. UPI ref no. 604488883333. Not you? Tap https://example.com to report -Kotak",
      source: { sender: "VM-KOTAKD-S" },
      want: { parserId: "kotak", type: "expense", amountMinor: 7300, last4: "6047", merchant: "SUNITA DEVI", ref: "604488883333" },
      auto: true,
    },
    {
      name: "credit card spend through UPI",
      text: "INR 45 spent on Kotak Credit Card x6047 on 03-OCT-2026 at UPI-604488884444-KULFI CART. Avl limit INR 41250.00",
      want: { parserId: "kotak", type: "expense", amountMinor: 4500, last4: "6047", merchant: "KULFI CART", ref: "604488884444" },
      auto: true,
    },
    {
      name: "refund to a card names the shop",
      text: "INR 265 from STARLIGHT CINEMAS refunded to your Kotak Credit Card x6047 on 03-Oct-2026.",
      want: { parserId: "kotak", type: "income", amountMinor: 26500, last4: "6047", merchant: "STARLIGHT CINEMAS" },
      auto: true,
    },
    {
      name: "IMPS credit from a mobile-linked account has no merchant",
      text: "Received Rs. 1,205.00 on 03-10-26 in your Kotak Bank A/C x6047 by an A/C linked to mobile x5521. IMPS Ref no 604488885555.",
      want: { parserId: "kotak", type: "income", amountMinor: 120500, last4: "6047", merchant: undefined, ref: "604488885555" },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "OTP 918406 for your Kotak Bank txn of Rs 1,140.00. Do not share it with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
