import { describe, expect, it } from "vitest";
import {
  BankParser,
  BANK_PARSERS,
  createCaptureParser,
  findBankParser,
  normaliseSender,
  parseCapture,
  type CaptureParse,
} from "@/lib/capture/parsers";
import type { FoundAccount } from "@/lib/capture/parsers/extract/account";

// Ticket 153: the parser is picked by sender. These tests use a made-up bank so they do not depend on which bank
// parsers exist; every message is invented (no real numbers).
const RECEIVED = new Date("2026-11-12T06:30:00Z"); // 12:00 IST, 12 Nov 2026

class TestBankParser extends BankParser {
  readonly id: string = "testbank";
  readonly bankName = "Test Bank";
  override readonly senderIds = ["TSTBNK"];
  override readonly packageNames = ["com.testbank.mobile"];
  protected override readonly confidenceBonus: number = 0.05;

  // Test Bank writes its account as "Acct:1234" with no mask, which the shared rule does not read.
  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    const m = text.match(/\bAcct:(\d{4})\b/);
    return m ? { last4: m[1], instrument: "account" } : super.account(text, type);
  }
}

const parse = createCaptureParser([new TestBankParser()]);
const SPEND = "Rs 420.00 debited from Acct:7788 on 12-11-26 to VPA chai@ybl. UPI Ref 631200001111";

const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};

describe("normaliseSender", () => {
  it("strips the operator prefix and the type suffix", () => {
    expect(normaliseSender("VM-HDFCBK")).toBe("HDFCBK");
    expect(normaliseSender("AX-HDFCBK-S")).toBe("HDFCBK");
    expect(normaliseSender("jd-icicit-t")).toBe("ICICIT");
    expect(normaliseSender("HDFCBK")).toBe("HDFCBK");
  });

  it("leaves a phone number or an app label alone and is empty for nothing", () => {
    expect(normaliseSender("+919800000000")).toBe("+919800000000");
    expect(normaliseSender("HDFC Bank")).toBe("HDFC BANK");
    expect(normaliseSender("  ")).toBeUndefined();
    expect(normaliseSender(undefined)).toBeUndefined();
  });
});

describe("findBankParser", () => {
  const parsers = [new TestBankParser()];

  it("picks the bank by its SMS header or its app package", () => {
    expect(findBankParser({ sender: "VM-TSTBNK-S" }, parsers)?.id).toBe("testbank");
    expect(findBankParser({ sender: "Test Bank", packageName: "com.testbank.mobile" }, parsers)?.id).toBe("testbank");
  });

  it("matches a subclass that lists its sender with a prefix or its package in mixed case", () => {
    class Loose extends TestBankParser {
      override readonly senderIds = ["VM-LOOSBK-S"];
      override readonly packageNames = ["Com.Loose.App"];
    }
    expect(findBankParser({ sender: "AD-LOOSBK" }, [new Loose()])).not.toBeNull();
    expect(findBankParser({ sender: "Loose", packageName: "com.loose.app" }, [new Loose()])).not.toBeNull();
  });

  it("matches a notification by its package only, never by a label that looks like a bank header", () => {
    expect(findBankParser({ sender: "AB-TSTBNK", packageName: "com.some.game" }, parsers)).toBeNull();
  });

  it("takes the first parser that claims a sender", () => {
    class Second extends TestBankParser {
      override readonly id = "second";
    }
    expect(findBankParser({ sender: "VM-TSTBNK" }, [new TestBankParser(), new Second()])?.id).toBe("testbank");
  });

  it("finds nothing for another sender or no sender at all", () => {
    expect(findBankParser({ sender: "VM-OTHRBK" }, parsers)).toBeNull();
    expect(findBankParser({}, parsers)).toBeNull();
    expect(findBankParser(undefined, parsers)).toBeNull();
  });

  it("tries the six ticket 155 bank parsers first, and a sender no parser owns still reads with the generic parser", () => {
    // The phase 9 groups (banks/groups/*) follow them; registry-groups.test.ts checks those.
    expect(BANK_PARSERS.slice(0, 6).map((p) => p.id)).toEqual(["hdfc", "icici", "sbi", "axis", "kotak", "idfc"]);
    expect(money(parseCapture(SPEND, RECEIVED, { sender: "VM-OTHRBK" })).parserId).toBe("generic");
  });
});

describe("createCaptureParser", () => {
  it("uses the sender's bank parser: its own account rule, its name and its confidence", () => {
    const p = money(parse(SPEND, RECEIVED, { sender: "AD-TSTBNK" }));
    expect(p).toMatchObject({ parserId: "testbank", bankName: "Test Bank", last4: "7788", amountMinor: 42000, type: "expense" });
    const generic = money(parse(SPEND, RECEIVED));
    expect(generic.parserId).toBe("generic");
    expect(generic.last4).toBeUndefined();
    expect(p.confidence).toBeGreaterThan(generic.confidence);
  });

  it("still ignores an OTP from a known bank", () => {
    expect(parse("482913 is your OTP for a payment of Rs 420. -Test Bank", RECEIVED, { sender: "VM-TSTBNK" })).toMatchObject({
      kind: "ignored",
      reason: "otp",
    });
  });

  it("reads an exact known format first, whatever the sender, and the generic parser after the bank parser", () => {
    const emi = parse(
      "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi Finserv loan account 010000000001 for October 2026.",
      RECEIVED,
      { sender: "VM-TSTBNK" }
    );
    expect(emi).toMatchObject({ kind: "loan_emi_payment", parserId: "navi_emi" });
    expect(parse("Your statement is ready to view.", RECEIVED, { sender: "VM-TSTBNK" }).kind).toBe("unknown");
  });

  it("hands a message the bank parser cannot read on to the generic parser", () => {
    class Picky extends TestBankParser {
      override parse(): null {
        return null;
      }
    }
    const p = money(createCaptureParser([new Picky()])(SPEND, RECEIVED, { sender: "VM-TSTBNK" }));
    expect(p.parserId).toBe("generic");
  });

  it("uses the bank's own rule for the card a bill payment went to", () => {
    class CardBank extends TestBankParser {
      protected override paidCard(text: string): FoundAccount | null {
        const m = text.match(/\bCard:(\d{4})\b/);
        return m ? { last4: m[1], instrument: "card" } : null;
      }
    }
    const bill = money(
      createCaptureParser([new CardBank()])("Payment of Rs 900.00 received towards your credit card Card:4455.", RECEIVED, {
        sender: "VM-TSTBNK",
      })
    );
    expect(bill).toMatchObject({ cardPayment: true, last4: "4455" });
  });

  it("never lets a bonus lift a spend abroad or a bill payment over its cap", () => {
    class Eager extends TestBankParser {
      protected override readonly confidenceBonus = 0.5;
    }
    const eager = createCaptureParser([new Eager()]);
    const abroad = money(eager("USD 25.00 spent on card XX7788 at STEAM on 12-11-26", RECEIVED, { sender: "VM-TSTBNK" }));
    expect(abroad.confidence).toBe(0.6);
    const bill = money(eager("Payment of Rs 5,000.00 received towards your credit card XX7788.", RECEIVED, { sender: "VM-TSTBNK" }));
    expect(bill.confidence).toBe(0.5);
  });

  it("reads every kind of message the same with or without a sender that no bank parser owns", () => {
    const messages = [
      SPEND,
      "INR 1,200.00 credited to your A/c No XX5678 on 12 Nov 2026 by NEFT from ACME PVT LTD",
      "Rs.5,000.00 withdrawn from A/c XX1234 at ATM on 12-11-26",
      "Payment of Rs 5,000.00 received towards your credit card XX7788. Thank you.",
      "USD 25.00 spent on card XX7788 at STEAM on 12-11-26",
      "Payment Successful: Advance EMI of Rs.3,980/- received towards Navi Finserv loan account 010000000001 for October 2026.",
      "Happy Shopping! INR 896.15 spent on your IDFC FIRST Bank Credit Card ending XX1832 at PAYPAL *SHOP on 12 NOV 2026 at 04:04 PM",
      "482913 is your OTP. Do not share.",
      "Your statement is ready to view.",
    ];
    for (const text of messages) {
      const plain = parseCapture(text, RECEIVED);
      expect(parseCapture(text, RECEIVED, { sender: "VM-OTHRBK-S" })).toEqual(plain);
      expect(parseCapture(text, RECEIVED, { sender: "Other Bank", packageName: "com.other.bank" })).toEqual(plain);
    }
  });

  it("keeps the shared caps: a spend abroad and a card bill payment always go to review", () => {
    const abroad = money(parse("USD 25.00 spent on card XX7788 at STEAM on 12-11-26", RECEIVED, { sender: "VM-TSTBNK" }));
    expect(abroad.confidence).toBeLessThanOrEqual(0.6);
    const bill = money(
      parse("Payment of Rs 5,000.00 received towards your credit card XX7788. Thank you.", RECEIVED, { sender: "VM-TSTBNK" })
    );
    expect(bill).toMatchObject({ cardPayment: true, last4: "7788" });
    expect(bill.confidence).toBeLessThanOrEqual(0.5);
  });
});
