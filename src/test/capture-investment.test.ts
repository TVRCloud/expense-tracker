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
      text: "Lotus MF: your SIP into Lotus Midcap Growth Fund DG for Rs.2,750.00 is processed; units go to your folio at the day's NAV.",
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

// Review of ticket 157: a bank's or a payment app's own message about a SIP or a redemption is the money itself, and a
// bare "fund" is not a fund house. None of these may be kept as a fund note. Re-worded, invented values.
describe("money about a fund is never a fund house note", () => {
  it.each([
    ["VM-HDFCBK-S", "Rs 4,950 has been debited from your HDFC Bank account XX5150 for SIP in Orchard Value Fund. SIP processed."],
    ["VM-HDFCBK-S", "Payment Successful! Rs. 4,950.00 from A/c ****5150 to BSE LIMITED MUTUAL FUND SIP via HDFC Bank NetBanking."],
    ["VM-HDFCBK-S", "Sent Rs.4950.00 From HDFC Bank A/C *5150 To ORCHARD MUTUAL FUND On 05/12/26. SIP has been registered."],
    ["VM-HDFCBK-S", "INR 11,640.00 deposited in HDFC Bank A/c XX5150 on 05-DEC-26 for NEFT Cr-ORCH0000123-MF REDEMPTION-ASHA. Redemption received."],
    ["AX-ICICIT-S", "INR 11,640.00 received in ICICI Bank Account XX515 from ORCHARD MUTUAL FUND redemption."],
    ["JD-SBIINB-S", "Rs 4,950 debited from SBI a/c XX7362 via NACH for SIP in Orchard Value Fund. SIP processed."],
    ["AX-AXISBK-S", "INR 4950.00 debited A/c no. XX6629 05-12-26 NACH/BSE LTD MUTUAL FUND SIP processed."],
    ["JD-KOTAKB-S", "Rs 4,950 debited from Kotak Bank A/c X3358 for SIP in Orchard Value Fund (folio XX884411) successfully."],
    ["JD-KOTAKB-S", "Sent Rs.4950.00 from Kotak Bank AC X3358 to icclmf@icici on 05-12-26. Purchase confirmed."],
    [undefined, "Paid ₹4,950 to Orchard Mutual Fund. SIP payment successful."],
    [undefined, "Received ₹11,640 from Orchard Mutual Fund. Redemption processed."],
    [undefined, "Rs 11,640 deposited to A/c XX5150. Redemption of 92.115 units completed."],
    [undefined, "Your account 5150 debited Rs 4,950 towards SIP in Orchard Value Fund successful."],
    [undefined, "Redemption of 92.115 units processed. Amount Rs 11,640 has been credited to HDFC Bank A/c XX5150."],
    [undefined, "Rs 1,900 paid to Chief Minister Relief Fund. Purchase confirmed via Card XX5583."],
    [undefined, "Rs 4,950 transferred to PM CARES Fund from A/c XX5150. Allotment of receipt confirmed."],
    [undefined, "Your fund transfer of Rs 9,850 has been processed from A/c XX5150."],
    [undefined, "Txn of Rs 4950 on Card XX5583 at PINEVALE MUTUAL FUND successful. Purchase processed."],
    [undefined, "Rs 14,120 refunded to your A/c XX5150 for unallotted IPO. Fund allotment completed."],
  ])("%s %s", (sender, text) => {
    const p = parseCapture(text, AT, { sender });
    expect(p.kind).not.toBe("investment");
    expect(p.kind).not.toBe("mandate");
  });
});

describe("a fund note never keeps a folio number or a PAN", () => {
  it.each([
    "Units allotted in folio 70013348 of Harbor Bluechip Fund at NAV 66.6052 for Rs 2,750.00.",
    "SIP of Rs 2,750 for PAN ABCDE1234F in Harbor Bluechip Fund processed at NAV 66.6052.",
  ])("%s", (text) => {
    const p = investment(parseCapture(text, AT));
    expect(p.fundName).toBe("Harbor Bluechip Fund");
    // Every text field: no 5-digit run (a folio) and no PAN. Amounts in paise are numbers, not text.
    const texts = Object.values(p).filter((v): v is string => typeof v === "string").join(" ");
    expect(texts).not.toMatch(/\d{5,}/);
    expect(texts).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/);
  });
});
