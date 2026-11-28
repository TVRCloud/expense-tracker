import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 171: invented messages in the shape Canara Bank sends (fake amounts, digits, refs and names).
describe("Canara Bank parser", () => {
  readsAll({ sender: "VM-CANBNK-S" }, [
    {
      name: "UPI debit with a three-digit account mask",
      text: "Dear Customer, Acct XXX482 Dr. INR 317.40 on 04/11/26 to MANGO LANE STORES; UPI: 631702498113; Bal INR 8,214.66.Not you? SMS BLOCKUPI to 9811100000-CanaraBank",
      want: { parserId: "canara", type: "expense", amountMinor: 31740, last4: "482", merchant: "MANGO LANE STORES", ref: "631702498113", balanceMinor: 821466 },
      auto: true,
    },
    {
      name: "UPI debit to a UPI id ending in a comma",
      text: "Dear Customer, Acct XXX482 Dr. INR 94.00 on 04/11/26 to tea.stall@ybl, UPI: 631702498336; Bal INR 8,118.66.Not you? SMS BLOCKUPI to 9811100000-CanaraBank",
      want: { parserId: "canara", type: "expense", amountMinor: 9400, merchant: "tea.stall@ybl" },
      auto: true,
    },
    {
      name: "UPI credit names the payer",
      text: "Dear Customer, Acct XX482 credited with INR 2,640.00 on 04-11-26 from LATA IYER; UPI:631702498227; Bal INR 10,854.66-CanaraBank",
      want: { parserId: "canara", type: "income", amountMinor: 264000, last4: "482", merchant: "LATA IYER" },
      auto: true,
    },
    {
      name: "NEFT credit takes the credited account, never the sender's",
      text: "An amount of INR 48,215.00 has been credited to XXXX3917 on 04/11/2026 towards NEFT by Sender ORBIT LOGISTICS PVT LTD, IFSC HDFC0001234, Sender A/c XXXX5521, HDFC BANK, PUNE BRANCH, UTR N308264519027715, Total Avail. Bal INR 61,402.18- Canara Bank",
      want: { parserId: "canara", type: "income", amountMinor: 4821500, last4: "3917", merchant: "ORBIT LOGISTICS PVT LTD" },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "Use OTP 862149 to approve Dr. INR 1,190.00 on Canara card ending 2741. Never share this code.-Canara Bank",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);
});
