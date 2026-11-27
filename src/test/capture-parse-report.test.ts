import { describe, expect, it } from "vitest";
import { BankParser, createCaptureParser } from "@/lib/capture/parsers";
import { buildReport, formatReport, sourceKey } from "@/lib/capture/parse-report";

// Ticket 154: made-up messages only.
const AT = new Date("2026-11-12T06:30:00Z");
const BOOKED = "Rs.640.00 debited from A/c XX4821 on 12-11-26 to VPA shop@ybl. UPI Ref 631233445566";
const REVIEW = "₹250 paid to Swiggy";
const OTP = "482913 is your OTP. Do not share.";
const UNKNOWN = "Your statement is ready to view.";

describe("sourceKey", () => {
  it("groups by app package, then by SMS header, and never prints a phone number", () => {
    expect(sourceKey({ channel: "notification", sender: "HDFC Bank", packageName: "Com.Snapwork.HDFC" })).toBe("app:com.snapwork.hdfc");
    expect(sourceKey({ channel: "sms", sender: "VM-HDFCBK-S" })).toBe("HDFCBK");
    expect(sourceKey({ channel: "sms", sender: "+919800000000" })).toBe("sms:phone number");
    expect(sourceKey({ channel: "sms", sender: "Some Long Label" })).toBe("sms:other");
    expect(sourceKey({ channel: "n8n" })).toBe("n8n:no sender");
  });

  it("never prints a sender or package that could carry message text or digits", () => {
    expect(sourceKey({ channel: "sms", sender: "XXXX4821" })).toBe("sms:other");
    expect(sourceKey({ channel: "sms", sender: "VM-AB1234" })).toBe("sms:other");
    expect(sourceKey({ channel: "notification", packageName: "Rs 640 debited from XX4821" })).toBe("app:other");
    expect(sourceKey({ channel: "notification", packageName: "a.4821" })).toBe("app:other");
    expect(sourceKey({ channel: "notification", packageName: "rs.640.debited" })).toBe("app:other");
    expect(sourceKey({ channel: "notification", packageName: "net.one97.paytm" })).toBe("app:net.one97.paytm");
    // A notification's label is the app's own name, never a bank header.
    expect(sourceKey({ channel: "notification", sender: "AB-HDFCBK" })).toBe("notification:no package");
  });
});

describe("buildReport", () => {
  it("counts each outcome per sender, most misses first, and what changed since capture", () => {
    const rows = buildReport([
      // Senders no bank parser owns, so the generic parser reads them whatever banks exist.
      { text: BOOKED, receivedAt: AT, channel: "sms", sender: "VM-OTHRBK", storedKind: "money" },
      { text: OTP, receivedAt: AT, channel: "sms", sender: "AD-OTHRBK", storedKind: "money" },
      { text: REVIEW, receivedAt: AT, channel: "sms", sender: "VM-NOBANK" },
      { text: UNKNOWN, receivedAt: AT, channel: "sms", sender: "VM-NOBANK" },
    ]);
    expect(rows.map((r) => r.source)).toEqual(["NOBANK", "OTHRBK"]);
    expect(rows[1]).toMatchObject({ total: 2, booked: 1, ignored: 1, changed: 1, bankParser: 0 });
    expect(rows[0]).toMatchObject({ total: 2, review: 1, unknown: 1, changed: 0 });
  });

  it("counts a mandate notice and a fund house note as info, never as a bank parser or unknown (ticket 157)", () => {
    const [row] = buildReport([
      { text: "UPI AutoPay mandate for CloudBox of Rs 129.00 has been revoked as requested.", receivedAt: AT, channel: "sms", sender: "VM-HARBMF" },
      {
        text: "Dear Investor, 41.287 units allotted in Folio No 70013348/21 under Harbor Bluechip Fund at NAV 66.6052 for Rs 2,750.00.",
        receivedAt: AT,
        channel: "sms",
        sender: "VM-HARBMF",
      },
    ]);
    expect(row).toMatchObject({ total: 2, info: 2, unknown: 0, bankParser: 0 });
  });

  it("counts a loan EMI and never counts a format or the ignore check as a bank parser", () => {
    const [row] = buildReport([
      {
        text: "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi Finserv loan account 010000000001 for October 2026.",
        receivedAt: AT,
        channel: "sms",
        sender: "VM-NAVIFN",
      },
      { text: OTP, receivedAt: AT, channel: "sms", sender: "VM-NAVIFN" },
    ]);
    expect(row).toMatchObject({ loan: 1, ignored: 1, bankParser: 0 });
  });

  it("counts what a registered bank parser read", () => {
    const [row] = buildReport([{ text: BOOKED, receivedAt: AT, channel: "sms", sender: "VM-HDFCBK" }]);
    expect(row).toMatchObject({ source: "HDFCBK", bankParser: 1 });
  });

  it("counts what a bank parser read", () => {
    class Hdfc extends BankParser {
      readonly id = "hdfc";
      readonly bankName = "HDFC Bank";
      override readonly senderIds = ["HDFCBK"];
    }
    const [row] = buildReport([{ text: BOOKED, receivedAt: AT, channel: "sms", sender: "VM-HDFCBK" }], createCaptureParser([new Hdfc()]));
    expect(row.bankParser).toBe(1);
  });

  it("prints counts and sender ids only, never the message", () => {
    const out = formatReport(buildReport([{ text: BOOKED, receivedAt: AT, channel: "sms", sender: "VM-HDFCBK" }]));
    expect(out).toContain("HDFCBK");
    expect(out).not.toMatch(/4821|640|shop@ybl/);
  });
});
