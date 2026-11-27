import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, createCaptureParser, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { sharedParty, vpaAfter } from "@/lib/capture/parsers/banks/known";

// Ticket 177: shared parser fixes found while reviewing the phase 9 bank parsers. Invented messages only.
const AT = new Date("2026-11-12T06:30:00Z");
const PHASE_8 = ["VM-HDFCBK-S", "AX-ICICIT-S", "JD-SBIINB-S", "AX-AXISBK-S", "JD-KOTAKB-S", "BM-IDFCFB-S"];
const ALL = [...PHASE_8, "VM-OTHRBK", undefined];
const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};
const read = (text: string, sender?: string) => parseCapture(text, AT, sender ? { sender } : undefined);

describe("a bank's shape bonus only with an account", () => {
  it.each([
    ["VM-HDFCBK-S", "Transaction Reversed! On HDFC Bank Rs.315 credited back on 06/11/26"],
    ["VM-HDFCBK-S", "Sent Rs.315.00 From HDFC Bank To lake.view@okicici On 06/11/26 Ref 633100778899"],
    ["AX-AXISBK-S", "INR 315.00 debited 06-11-26, 10:12:44 UPI/P2M/633100778899/LAKE VIEW Axis Bank"],
  ])("%s: a shaped read naming no account stays in Review: %s", (sender, text) => {
    const p = money(read(text, sender));
    expect(p.last4).toBeUndefined();
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("still adds the bonus when the account is named", () => {
    // No date, so the score stays below the ceiling and the bonus shows.
    const text = "Sent Rs.315.00 From HDFC Bank A/C *5150 To lake.view@okicici Ref 633100778899";
    expect(money(read(text, "VM-HDFCBK-S")).confidence).toBeGreaterThan(money(createCaptureParser([])(text, AT)).confidence);
  });
});

describe("paid with a card is a spend, not a card bill payment", () => {
  it.each(ALL)("%s", (sender) => {
    const p = money(read("Thank you for your payment of Rs 615 to Jio Fiber using credit card XX8840 on 06-11-26", sender));
    expect(p).toMatchObject({ type: "expense", last4: "8840" });
    expect(p.cardPayment).toBeUndefined();
  });

  it("a real bill payment is still one", () => {
    const p = money(read("Payment of Rs 6,150.00 received towards your Credit Card XX8840. Thank you.", "VM-HDFCBK-S"));
    expect(p).toMatchObject({ cardPayment: true, last4: "8840" });
  });
});

describe("'<bank> Credit Card XX#### credited' is a card bill payment for every sender", () => {
  it.each(ALL)("%s", (sender) => {
    const p = money(read("ICICI Bank Acct XX274 debited for Rs 6,150.00 on 06-Nov-26; ICICI Bank Credit Card XX8840 credited. UPI:633100221144", sender));
    expect(p).toMatchObject({ cardPayment: true, last4: "8840", instrument: "card" });
    expect(p.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe("a declined transaction moved no money", () => {
  it.each(ALL)("%s", (sender) => {
    expect(read("Rs.61.50 debited to your RuPay Credit Card ending 8840 on 06/11/26 has been declined.", sender)).toMatchObject({
      kind: "ignored",
      reason: "not_financial",
    });
    expect(read("Your transaction of Rs 615 at LAKE VIEW on Card XX8840 is declined due to incorrect PIN.", sender)).toMatchObject({
      kind: "ignored",
    });
  });

  it("a spend followed by an unrelated line about a decline is still a spend", () => {
    expect(money(read("Rs 615 spent on Card XX8840 at LAKE VIEW on 06-11-26. Card has been declined earlier? Ignore.", "VM-OTHRBK")).type).toBe("expense");
  });

  it("money that came back after a decline is still read", () => {
    expect(read("Rs 615 debited on Card XX8840 has been declined and reversed to your account.", "VM-OTHRBK").kind).toBe("money");
  });
});

describe("a debit the same message says came back stays in Review, for every parser", () => {
  it.each(ALL)("%s", (sender) => {
    for (const text of [
      "Your a/c XX4419 debited Rs 615.00 on 06-11-26 trf to LAKE VIEW has been reversed",
      "Cheque of Rs 12,150.00 debited from A/c XX4419 on 06-11-26 returned unpaid",
    ]) {
      const p = money(read(text, sender));
      expect(p.confidence, text).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    }
  });

  it("a shop whose name says refund is still an ordinary spend", () => {
    const p = money(read("Rs 615.00 debited from A/c XX4419 on 06-11-26 to REFUND KITCHEN. Ref 633100778899", "VM-OTHRBK"));
    expect(p).toMatchObject({ type: "expense", merchant: "REFUND KITCHEN" });
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });

  it("a reversal credit on its own is still booked", () => {
    const p = money(read("Rs.615.00 credited to A/c XX4419 on 06-11-26 as reversal of failed cash withdrawal", "VM-OTHRBK"));
    expect(p.type).toBe("income");
    expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });
});

describe("a shaped spend that says it was reversed stays in Review", () => {
  it.each(PHASE_8)("%s", (sender) => {
    const p = money(read("Sent Rs.615.00 From HDFC Bank A/C *5150 To LAKE VIEW On 06/11/26 Ref 633100778899 is reversed", sender));
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("a refund credit is still booked", () => {
    const p = money(read("Rs.615.00 credited to HDFC Bank A/c XX5150 on 06-11-26 as refund from LAKE VIEW (UPI 633100778899)", "VM-HDFCBK-S"));
    expect(p.type).toBe("income");
  });
});

describe("merchant cleanup", () => {
  it("a UPI id never keeps the bank's next word", () => {
    expect(vpaAfter("to", "debited to VPA 9847061500@ybl.Ref No 633100778899")).toBe("9847061500@ybl");
    expect(vpaAfter("to", "to VPA lake.view@ybl.Avl Bal Rs 2000")).toBe("lake.view@ybl");
    expect(vpaAfter("to", "paid to lake.view@okicici on 06")).toBe("lake.view@okicici");
  });

  it("single-X masks and masks inside a number are never a merchant", () => {
    expect(sharedParty("X6612 RAVI")).toBeUndefined();
    expect(sharedParty("FD closure 512***778402")).toBeUndefined();
    expect(sharedParty("XBOX STORE")).toBe("XBOX STORE");
    expect(sharedParty("MAX 2000 STORE")).toBe("MAX 2000 STORE");
  });
});
