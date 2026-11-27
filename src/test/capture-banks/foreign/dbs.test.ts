import { describe, expect, it } from "vitest";
import { parseCapture } from "@/lib/capture/parsers";
import { readsAll, RECEIVED } from "../helpers";

// Ticket 174: invented messages in DBS India's shapes.
describe("DBS parser", () => {
  readsAll({ sender: "VM-DBSBNK-S" }, [
    {
      name: "account debit",
      text: "Your account no ********5832 is debited with INR 715.00 on 14-10-26. Current Balance is INR 12,640.10. - DBS Bank",
      want: { parserId: "dbs", bankName: "DBS Bank", type: "expense", amountMinor: 71500, last4: "5832" },
      auto: true,
    },
    {
      name: "UPI credit from a UPI id",
      text: "Your account no ********5832 is credited with INR 3,530.00 on 14-10-26 by UPI from priya.s@okicici. - DBS Bank",
      want: { parserId: "dbs", type: "income", amountMinor: 353000, last4: "5832", merchant: "priya.s@okicici" },
      auto: true,
    },
    {
      name: "IMPS credit from a person",
      text: "Your account no ********5832 is credited with INR 1,975.00 on 15-10-26 by IMPS from SANJAY GHOSH. - DBS Bank",
      want: { parserId: "dbs", type: "income", amountMinor: 197500, last4: "5832" },
      auto: true,
    },
    {
      name: "UPI debit to a UPI id",
      text: "Your account no ********5832 is debited with INR 128.00 on 15-10-26 by UPI to chaiwala.b@okaxis. - DBS Bank",
      want: { parserId: "dbs", type: "expense", amountMinor: 12800, last4: "5832", merchant: "chaiwala.b@okaxis" },
      auto: true,
    },
    {
      name: "an OTP is ignored",
      text: "DBS Bank: 271946 is your OTP for a transfer of INR 3,215.00. Do not share it with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
  ]);

  it("leaves a 'Current Balance' unread (on a card it would be the amount owed)", () => {
    const p = parseCapture("Your account no ********5832 is debited with INR 715.00 on 14-10-26. Current Balance is INR 12,640.10. - DBS Bank", RECEIVED, {
      sender: "VM-DBSBNK-S",
    });
    expect(p.kind === "money" && p.balanceMinor).toBeFalsy();
  });
});
