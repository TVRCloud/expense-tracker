import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape Jana Small Finance Bank sends. Its account mask has three digits.
describe("Jana Small Finance Bank parser", () => {
  readsAll({ sender: "JM-JANABK-S" }, [
    {
      name: "UPI debit to a UPI id",
      text: "Dear Customer, Your acct XX318 is debited with INR 418.00 on 14-Nov-26 to tiffin.hub@okicici. UPI Ref no 638255660011 . JANA SFB",
      want: { parserId: "jana", type: "expense", amountMinor: 41800, last4: "318", merchant: "tiffin.hub@okicici", ref: "638255660011" },
      auto: true,
    },
    {
      name: "UPI credit from a name",
      text: "Dear Customer, Your acct XX318 is credited with INR 2,200.00 on 14-Nov-26 from RAHUL NAIR. UPI Ref no 638255660012 . JANA SFB",
      want: { parserId: "jana", type: "income", amountMinor: 220000, last4: "318", merchant: "RAHUL NAIR" },
      auto: true,
    },
  ]);
});
