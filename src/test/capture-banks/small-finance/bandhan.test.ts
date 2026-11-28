import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape Bandhan Bank sends.
describe("Bandhan Bank parser", () => {
  readsAll({ sender: "AD-BDNSMS-S" }, [
    {
      name: "UPI debit with the payee before Value",
      text: "INR 264.00 debited from A/c XXXXXXXXXX4417 towards UPI/DR/D638233108811/Lotus Pharma Value 14-NOV-2026 . Clear Bal is INR 8,412.60. Bandhan Bank",
      want: { parserId: "bandhan", type: "expense", amountMinor: 26400, last4: "4417", merchant: "Lotus Pharma", ref: "638233108811", balanceMinor: 841260 },
      auto: true,
    },
    {
      name: "UPI deposit",
      text: "INR 11,860.00 deposited to A/c XXXXXXXXXX4417 towards UPI/CR/C638233108812/NIKHIL SHARMA/u on 14-NOV-2026 . Clear Bal is INR 20,412.60 . Bandhan Bank.",
      want: { parserId: "bandhan", type: "income", amountMinor: 1186000, last4: "4417", merchant: "NIKHIL SHARMA", balanceMinor: 2041260 },
      auto: true,
    },
    {
      name: "interest credit",
      text: "Dear Customer, your account XXXXXXXXXX4417 is credited with INR 6.37 on 01-NOV-2026 towards interest. Bandhan Bank",
      source: { sender: "BP-BANDHN-S" },
      want: { parserId: "bandhan", type: "income", amountMinor: 637, last4: "4417" },
      auto: true,
    },
    {
      name: "the reference drops its D letter",
      text: "INR 1,935.00 debited from A/c XXXXXXXXXX4417 towards UPI/DR/D638233108813/Fresh Fold Laundry Value 14-NOV-2026 . Clear Bal is INR 6,477.60. Bandhan Bank",
      want: { parserId: "bandhan", type: "expense", amountMinor: 193500, merchant: "Fresh Fold Laundry", ref: "638233108813" },
      auto: true,
    },
    {
      name: "an OTP from the bank stays ignored",
      text: "Your Bandhan Bank OTP is 471903 for a UPI payment of INR 935.00. Do not share with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
