import { describe, expect, it } from "vitest";
import { parseCapture, type CaptureParse } from "@/lib/capture/parsers";

// Ticket 157: a fund house's or registrar's note is kept for the record and never booked (the bank sends its own
// debit or credit for the money). Invented messages only.
const AT = new Date("2026-12-05T06:30:00Z");

const investment = (p: CaptureParse) => {
  if (p.kind !== "investment") throw new Error(`expected investment, got ${p.kind}`);
  return p;
};

describe("fund house messages", () => {
  it.each([
    {
      sender: "VM-LOTSMF",
      text: "Unit Allotment Update: Your SIP purchase of Rs.2,750.00 in Lotus Midcap Growth Fund DG has been processed at applicable NAV. Units will be alloted in 1-2 working days.",
      want: { event: "sip", fundName: "Lotus Midcap Growth Fund DG", amountMinor: 275000 },
    },
    {
      sender: "VM-CAMSPL",
      text: "Dear Investor, 41.287 units allotted in Folio No 70013348/21 under Harbor Bluechip Fund - Direct Growth at NAV 66.6052 for Rs 2,750.00 on 03-Dec-2026. -HarborMF",
      want: { event: "allotment", fundName: "Harbor Bluechip Fund - Direct Growth", units: "41.287", nav: "66.6052", folioLast4: "3348", amountMinor: 275000 },
    },
    {
      sender: "VM-KFINTK",
      text: "Redemption of 12.640 units of Harbor Liquid Fund in folio XXXXXX4821 processed. Amount Rs 31,250.00 will be credited to your bank account in 2 working days.",
      want: { event: "redemption", fundName: "Harbor Liquid Fund", units: "12.640", folioLast4: "4821", amountMinor: 3125000 },
    },
    {
      sender: undefined,
      text: "Your purchase of Rs 14,350.00 in Northwind Flexi Cap Fund - Regular Plan is confirmed. 228.140 units allotted at NAV 65.7491.",
      want: { event: "purchase", amountMinor: 1435000, units: "228.140", nav: "65.7491" },
    },
    {
      sender: undefined,
      text: "Switch of 47.215 units from Harbor Liquid Fund to Harbor Bluechip Fund has been processed for folio 70013348.",
      want: { event: "switch", units: "47.215", folioLast4: "3348" },
    },
  ])("$want.event: $text", ({ sender, text, want }) => {
    const p = investment(parseCapture(text, AT, { sender }));
    expect(p).toMatchObject(want);
    // Never the whole folio number.
    expect(JSON.stringify(p)).not.toContain("70013348");
  });

  it.each([
    // The bank's own debit or credit for the money: a normal money parse.
    ["VM-HDFCBK-S", "Rs 2,750.00 debited from A/c XX7362 on 05-12-26 towards SIP Harbor Bluechip Fund. Ref 633900445566", "money"],
    ["AX-ICICIT-S", "ICICI Bank Acct XX305 debited for Rs 2,750.00 on 05-Dec-26; HARBOR MUTUAL FUND credited. UPI:633900445577.", "money"],
    ["VM-HDFCBK-S", "Rs 31,250.00 credited to your A/c XX7362 on 07-12-26 by NEFT from HARBOR MUTUAL FUND redemption.", "money"],
    // Not a settled fund event.
    [undefined, "Your SIP instalment of Rs 2,750 in Harbor Bluechip Fund failed due to insufficient balance.", "ignored"],
    [undefined, "Your SIP of Rs 2,750 in Harbor Bluechip Fund is due on 05-12-2026.", "ignored"],
    [undefined, "NAV updated for Harbor Liquid Fund. Latest NAV: 2,503.1172.", "unknown"],
  ])("%s %s is not a fund house note", (sender, text, kind) => {
    expect(parseCapture(text, AT, { sender }).kind).toBe(kind);
  });
});

describe("a card or account spend at a fund is still money", () => {
  it.each([
    "Mutual fund purchase of Rs 5,000.00 debited from your card XX4417 on 05-12-26. Units will be allotted at applicable NAV.",
    "Rs 5,000.00 spent on Card XX4417 at HARBOR MUTUAL FUND on 05-12-26. SIP purchase processed.",
  ])("%s", (text) => {
    expect(parseCapture(text, AT).kind).toBe("money");
  });
});
