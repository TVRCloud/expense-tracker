import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";

// Ticket 157: mandate notices are kept, never booked; a debit made under a mandate is booked; money into a loan is
// spending from the account it left. Invented messages only.
const AT = new Date("2026-12-05T06:30:00Z");
const SENDERS = ["VM-HDFCBK-S", "AX-ICICIT-S", "JD-SBIINB-S", "AX-AXISBK-S", "JD-KOTAKB-S", "BM-IDFCFB-S", undefined];
const generic = createCaptureParser([]);

const mandate = (p: CaptureParse) => {
  if (p.kind !== "mandate") throw new Error(`expected mandate, got ${p.kind}`);
  return p;
};
const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};

describe("mandate notices", () => {
  it.each([
    {
      text: "Your UPI-Mandate for Rs.637.00 is successfully created towards STREAMLY from A/c No: XXXX7362. UMN: 4f2a91c0d2@okaxis -Axis Bank",
      want: { event: "created", merchant: "STREAMLY", maxAmountMinor: 63700, last4: "7362" },
    },
    {
      text: "You have successfully created a mandate on TuneBox for a MONTHLY frequency starting from 05-12-2026 for a maximum amount of Rs 189.00. Mandate Ref No- 7c1e90aa31@okhdfc",
      want: { event: "created", merchant: "TuneBox", maxAmountMinor: 18900, frequency: "monthly" },
    },
    {
      text: "NACH mandate registration for Rs 23,600.00 in favour of BRIGHTPATH FINANCE LTD has been successfully registered on your A/c XX7362. UMRN HDFC7000000012345678 -HDFC Bank",
      want: { event: "created", merchant: "BRIGHTPATH FINANCE LTD", maxAmountMinor: 2360000, last4: "7362", bankName: "HDFC Bank" },
    },
    { text: "UPI AutoPay mandate for CloudBox of Rs 129.00 has been revoked as requested. -Kotak Bank", want: { event: "revoked", merchant: "CloudBox", maxAmountMinor: 12900 } },
    { text: "Your e-mandate for GYMPASS has been paused till 31-01-2027.", want: { event: "paused", merchant: "GYMPASS" } },
    { text: "Your AutoPay for StreamFlix has been resumed.", want: { event: "resumed", merchant: "StreamFlix" } },
    { text: "Mandate amount for TuneBox modified to Rs 279.00 monthly.", want: { event: "modified", merchant: "TuneBox", maxAmountMinor: 27900, frequency: "monthly" } },
    { text: "Standing instruction on Card XX4417 for MEDIPLAN has been cancelled.", want: { event: "revoked", merchant: "MEDIPLAN" } },
  ])("reads $want.event for every sender: $text", ({ text, want }) => {
    for (const sender of SENDERS) expect(mandate(parseCapture(text, AT, { sender }))).toMatchObject(want);
  });

  it("keeps the start and end dates printed", () => {
    const start = mandate(parseCapture("You have successfully created a mandate on TuneBox for a MONTHLY frequency starting from 05-12-2026 for a maximum amount of Rs 189.00.", AT));
    expect(start.startDate?.toISOString().slice(0, 10)).toBe("2026-12-05");
    const until = mandate(parseCapture("Your e-mandate for GYMPASS has been paused till 31-01-2027.", AT));
    expect(until.validUntil?.toISOString().slice(0, 10)).toBe("2027-01-31");
  });

  it("never stores a mandate reference or an amount as the merchant", () => {
    const p = mandate(parseCapture("UPI mandate for Rs 637.00 created. UMN 4f2a91c0d2@okaxis", AT));
    expect(p.merchant).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("4f2a91c0d2");
  });

  it.each([
    // A request waiting for approval, a failure, a pre-debit notice and an OTP are not mandate notices.
    ["STREAMLY has requested a mandate of Rs 637 on your UPI. Approve the request in your UPI app.", "ignored"],
    ["Your mandate creation for STREAMLY has failed. Please try again.", "ignored"],
    ["Pre-debit notification: Rs 637 will be debited on 05-12-26 for your UPI AutoPay mandate created for STREAMLY.", "ignored"],
    ["Use OTP 583104 to create your e-mandate for STREAMLY. Do not share it.", "ignored"],
  ])("%s is not a mandate notice", (text, kind) => {
    expect(parseCapture(text, AT).kind).toBe(kind);
  });
});

describe("debits made under a mandate", () => {
  it.each([
    ["VM-HDFCBK-S", "Rs.637.00 debited from A/c XX7362 on 05-12-26 towards e-mandate STREAMLY. Avl Bal Rs 4,210.00"],
    ["AX-AXISBK-S", "Rs 637.00 debited from A/c XX7362 on 05-12-26 for UPI AutoPay mandate STREAMLY. UPI Ref 633900112233"],
    ["JD-SBIINB-S", "Your A/c X7362 is debited by Rs.637.00 on 05Dec26 for mandate payment to STREAMLY. -SBI"],
  ])("%s: booked like any debit", (sender, text) => {
    const p = money(parseCapture(text, AT, { sender }));
    expect(p).toMatchObject({ type: "expense", amountMinor: 63700, last4: "7362" });
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
    expect(p.merchant ?? "").not.toMatch(/mandate/i);
  });

  it.each(SENDERS)("%s: money moved while setting a mandate up stays in Review", (sender) => {
    for (const text of [
      "Rs 1.00 debited from A/c XX7362 on 05-12-26 for e-mandate registration of STREAMLY.",
      "Acct XX7362 credited with Rs 1.00 on 05-12-26 for NACH mandate verification.",
    ]) {
      const p = parseCapture(text, AT, { sender });
      if (p.kind === "money" && sender) expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
      expect(p.kind).not.toBe("mandate");
    }
  });
});

describe("money into a loan", () => {
  it.each([
    "Your loan account XX6618 is credited with Rs 2,315.00 by debit to A/c XX7362 on 05-12-26.",
    "Your loan a/c no XX6618 has been credited with Rs 2,315.00 by debit from A/c XX7362 on 05-12-26.",
    "Rs 2,315.00 debited from A/c XX7362 and credited to your loan account XX6618 on 05-12-26.",
  ])("is spending from the person's account for every sender: %s", (text) => {
    for (const sender of SENDERS) {
      expect(money(parseCapture(text, AT, { sender })), String(sender)).toMatchObject({ type: "expense", amountMinor: 231500, last4: "7362" });
    }
    expect(money(generic(text, AT)).merchant ?? "").not.toMatch(/^debit$/i);
  });

  it("without the account it left, it is spending checked in Review, never income", () => {
    for (const sender of SENDERS) {
      const p = money(parseCapture("EMI of Rs 2,315.00 credited to your loan account XX6618 on 05-12-26.", AT, { sender }));
      expect(p.type).toBe("expense");
      expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    }
  });

  it("a loan paid out to the person is still income", () => {
    const p = money(parseCapture("Your loan a/c XX6618 has been disbursed and Rs 1,50,000.00 credited to your A/c XX7362 on 05-12-26.", AT, { sender: "VM-HDFCBK-S" }));
    expect(p).toMatchObject({ type: "income", last4: "7362" });
  });
});
