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

describe("a declined transaction", () => {
  it.each(ALL)("%s: with no money verb it moved nothing", (sender) => {
    expect(read("Your transaction of Rs 615 at LAKE VIEW on Card XX8840 is declined due to incorrect PIN.", sender)).toMatchObject({
      kind: "ignored",
    });
  });

  it.each(ALL)("%s: with a money verb it is never dropped, only checked in Review", (sender) => {
    for (const text of [
      "Rs.61.50 debited to your RuPay Credit Card ending 8840 on 06/11/26 has been declined.",
      "Rs.540.00 debited from A/c XX4471 on 11-11-26 to BLUE KETTLE, your previous attempt was declined. Ref 633100778899",
      "Txn of Rs 540 at BLUE KETTLE was declined due to wrong PIN. Rs 25.00 debited from A/c XX4471 as decline charges.",
    ]) {
      const p = money(read(text, sender));
      expect(p.confidence, text).toBeLessThanOrEqual(0.5);
    }
  });

  it("a help line asking about a declined txn is not a decline", () => {
    const p = money(read("Rs.540.00 debited from A/c XX4471 on 11-11-26 to VPA bluekettle@okaxis.Txn declined? Call 18001234567", "VM-OTHRBK"));
    expect(p.type).toBe("expense");
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

  // The word counts anywhere, even in a shop's name: a captured name could otherwise swallow it.
  it("a shop whose name says refund goes to Review (accepted noise)", () => {
    const p = money(read("Rs 615.00 debited from A/c XX4419 on 06-11-26 to REFUND KITCHEN. Ref 633100778899", "VM-OTHRBK"));
    expect(p).toMatchObject({ type: "expense", merchant: "REFUND KITCHEN" });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it.each([undefined, "VM-OTHRBK"])("%s: a name that swallows the reversal word never hides it", (sender) => {
    for (const text of [
      "Rs 615.00 debited from A/c XX4419 on 06-11-26 at PINE GROCER reversed",
      "Rs 615.00 debited from A/c XX4419 on 06-11-26 to LAKEVIEW - REVERSED",
      "Rs 615.00 debited from A/c XX4419 by NEFT of MEERA NAIR, returned on 07-11-26",
      "Rs 615.00 debited from A/c XX4419 on 06-11-26 at REV . TRANSACTION REVERSED",
      "Rs 615.00 debited from A/c XX4419 on 06-11-26 at FUND . REFUNDED",
    ]) {
      const p = read(text, sender);
      if (p.kind === "money" && p.type === "expense") expect(p.confidence, text).toBeLessThan(CONFIDENCE_AUTO_CREATE);
      else expect(p.kind === "money" ? p.confidence : 0, text).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    }
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

describe("a card spend written as 'Thank you for using … Card … for INR' is never dropped", () => {
  it.each(ALL)("%s: a help line about failed transactions does not make it a failure", (sender) => {
    const p = money(
      read(
        "Thank you for using Lakeside Bank Credit Card XXXX8840 for INR 615.00 on 06-Nov-26 at PINE GROCER\nNot you? SMS BLOCK 8840 to 5600000 to get any failed or disputed txn checked",
        sender
      )
    );
    expect(p).toMatchObject({ type: "expense", amountMinor: 61500, last4: "8840" });
    expect(p.merchant ?? "").not.toMatch(/failed|disputed|get any/i);
  });

  it.each(ALL)("%s: a refund still to come keeps it a spend to check in Review", (sender) => {
    const p = money(
      read("Thank you for using Lakeside Bank Credit Card XXXX8840 for INR 715.00 on 06-Nov-26 at PINE GROCER . A refund of INR 715.00 will be credited in 5 days.", sender)
    );
    expect(p).toMatchObject({ type: "expense", amountMinor: 71500 });
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("'You have used your card … for Rs …' is a spend too", () => {
    expect(money(read("You have used your Lakeside Bank Debit Card XX8840 for Rs 315.00 at PINE GROCER on 06-11-26.", "VM-OTHRBK")).type).toBe("expense");
  });

  it("help text is never a merchant", () => {
    const p = money(read("Acct XX274 debited Rs. 615.00 on 06-Nov-26. Avl Bal Rs. 2,000.00. To dispute call 1800000000 or SMS BLOCK 274 to 9300000000 .", "VM-OTHRBK"));
    expect(p.merchant).toBeUndefined();
  });
});

describe("any wording that undoes a debit sends it to Review", () => {
  const SPEND = "Rs 615.00 spent on card XX8840 at PINE GROCER on 06-11-26.";
  it.each([undefined, "VM-OTHRBK"])("%s", (sender) => {
    for (const tail of [
      "This transaction was cancelled by the merchant.",
      "Transaction voided on 07-Nov-26.",
      "Chargeback of Rs 615.00 approved.",
      "Rs 615.00 reimbursed to your card.",
      "Txn rolled back.",
      "Amount re-credited.",
      "Amount adjusted back to your card.",
      "Amount credited back.",
    ]) {
      const p = money(read(`${SPEND} ${tail}`, sender));
      expect(p.confidence, tail).toBeLessThanOrEqual(0.75);
    }
  });

  it("an ordinary spend is still booked", () => {
    expect(money(read(SPEND, "VM-OTHRBK")).confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });
});

describe("ticket 177 review, round 2", () => {
  it.each(ALL)("%s: a card use whose transaction did not go through is dropped, a scheduled one is a reminder", (sender) => {
    for (const text of [
      "Thank you for using Lakeside Bank Credit Card XXXX4471 for INR 540.00 at BLUE KETTLE on 11-Nov-26. The transaction was declined due to insufficient limit.",
      "You have used your Lakeside Bank Credit Card XX4471 for Rs 540 at BLUE KETTLE. Txn declined due to incorrect PIN.",
      "Thank you for using your Debit Card XX4471 for Rs 540.00 at BLUE KETTLE. Txn unsuccessful.",
      "Thank you for using Lakeside Bank Credit Card XXXX4471 for INR 540.00 on 11-Nov-26 at BIRCH STORE . Txn declined.",
    ]) {
      expect(read(text, sender).kind, text).toBe("ignored");
    }
    expect(read("Thank you for using your Lakeside Bank Credit Card XX4471 for Rs 540 at BLUE KETTLE. Your payment is scheduled for 15-11-26.", sender)).toMatchObject({
      kind: "ignored",
      reason: "reminder",
    });
  });

  it.each(ALL)("%s: a card bill paid with a debit card is a card payment, never a spend", (sender) => {
    for (const text of [
      "Payment of Rs 12,000 towards your SBI Credit Card XX5678 using your HDFC Bank Debit Card is successful.",
      "Thank you for your payment of Rs 12,000 to your Credit Card XX5678 using Debit Card XX4471.",
      "Thank you for using your Debit Card XX4471 for Rs 12,000 payment towards Credit Card XX5678.",
    ]) {
      const p = read(text, sender);
      if (p.kind === "money") {
        expect(p.confidence, text).toBeLessThanOrEqual(0.5);
        expect(p.merchant ?? "", text).not.toMatch(/credit card|5678/i);
      }
    }
  });

  it.each([undefined, "VM-OTHRBK"])("%s: money put back on the card goes to Review", (sender) => {
    const SPEND = "Thank you for using Lakeside Bank Credit Card XXXX5917 for INR 913.00 on 09-Nov-26 at BIRCH STORE .";
    for (const tail of [
      "The amount has been reverted to your account.",
      "A credit of INR 913.00 has been posted to your card.",
      "INR 913.00 credit posted to card on 10-Nov-26.",
      "INR 913.00 Cr to card on 10-Nov-26.",
    ]) {
      expect(money(read(`${SPEND} ${tail}`, sender)).confidence, tail).toBeLessThanOrEqual(0.75);
    }
  });

  it("a reference written as a mask is never the card", () => {
    const p = money(read("Thank you for using Lakeside Bank Debit Card 47xx for INR 762.00 on 08-Nov-26 at FERN MARKET ref XX5163 .", "VM-OTHRBK"));
    expect(p.last4).toBeUndefined();
  });

  it("shops whose names start like a help line keep their name; a bank-and-digits party is never one", () => {
    expect(money(read("INR 615.00 debited from A/c XX4419 on 06-11-26 to BLOCK C STATIONERS. Ref 633100778899", "VM-OTHRBK")).merchant).toBe("BLOCK C STATIONERS");
    expect(money(read("Rs 615.00 debited from A/c XX4419 on 06-11-26 to Get Fit Gym. Ref 633100778899", "VM-OTHRBK")).merchant).toBe("Get Fit Gym");
    expect(money(read("INR 615.00 debited from Equitas-4419 via UPI -Ref:633100778899 on 06-11-26.", "VM-OTHRBK")).merchant).toBeUndefined();
  });

  it("a shop named with an X and digits keeps its name", () => {
    expect(sharedParty("STUDIO X2024")).toBe("STUDIO X2024");
  });

  it("a thank-you promo with no card digits and no shop is not a spend", () => {
    const p = read("Thank you for using your Lakeside Bank Credit Card for Rs 1,00,000 worth of spends this year! Get 5,000 bonus points.", "VM-OTHRBK");
    expect(p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE).toBe(false);
  });
});

describe("a card bill paid from an account, generic parser too", () => {
  it.each([undefined, "VM-OTHRBK"])("%s", (sender) => {
    for (const text of [
      "Rs 4,180.00 debited from A/c XX7305 on 03-11-26 towards Lakeside Bank Credit Card XX2614. Avl Bal Rs 18,306.00",
      "Your A/C XXXXX9283 is debited by INR 3,940.00 on 04/10/26 towards credit card bill. New Bal :INR 1,212.40",
      "INR 7,360.00 debited from A/c no. XX441907 on 05-10-26. Paid to Lakeside Bank Credit Card XX2208.",
      "Rs.4,780.00 debited from A/c XX5150 on 05-10-26. Towards Lakeside Bank Credit Card XX6047. Ref 604400132424.",
      "Rs.3,975.00 debited from A/c XX5150 on 05-10-26. Info: Credit Card Payment XX6047.",
    ]) {
      const p = money(read(text, sender));
      expect(p.cardPayment, text).toBe(true);
      expect(p.confidence, text).toBeLessThanOrEqual(0.5);
    }
  });

  it("a spend paid with a credit card stays a spend", () => {
    expect(money(read("Rs 615 debited using credit card XX8840 at PINE GROCER on 06-11-26", "VM-OTHRBK")).cardPayment).toBeUndefined();
    expect(money(read("Thank you for your payment of Rs 615 to Jio Fiber using credit card XX8840 on 06-11-26", "VM-OTHRBK")).type).toBe("expense");
  });
});

describe("a help line never holds an ordinary debit; a reversal stated in it still does", () => {
  const BASE = "Rs 615.00 debited from A/c XX4419 on 06-11-26 to LAKE VIEW.";
  it.each([undefined, "VM-OTHRBK", "VM-HDFCBK-S"])("%s", (sender) => {
    for (const tail of [
      "For refunds or disputes call 18001234-LKB",
      "Not you? To block and reverse call 18001234567",
      "Know your refund status at lakeside.in/refund",
    ]) {
      expect(money(read(`${BASE} ${tail}`, sender)).confidence, tail).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
    }
    for (const tail of ["Txn reversed. Call 1800 123 4567 for queries.", "Amount has been reversed, call 18001234567 for details"]) {
      expect(money(read(`${BASE} ${tail}`, sender)).confidence, tail).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    }
  });

  it("a payee written with a mobile number is no help line: its reversal is still held", () => {
    const p = money(read("Lakeside Bank A/c*5093 Dr Rs214.00 on 04-11-26 13:43 by MB 9601234567 NAVKAR MEDICALS reversed, Bal Rs3,105.80", "VM-OTHRBK"));
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("a help line glued to the money sentence never removes its own doubt", () => {
    const text = "Your a/c XX5832 is debited for Rs. 418.00 on 14-10-2026 18:22 and credited to a/c XX9046 (UPI Ref no 629311224455).Plz call 18004190336 if not done by you.";
    expect(money(read(text, "VM-HDFCBK-S")).confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });

  it("a UPI path that ends in REVERSED is held even with a long reference in it", () => {
    const p = money(read("A/c No **7326 Debited with Rs 655--UPI/DR/633100667792/GROCERY NOOK/YESB/U REVERSED (CLR BAL 7130.25CR)(04-11-2026)", "VM-OTHRBK"));
    expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });
});

// Ticket 177 review round 3: a help line never hides a reversal; only help ABOUT refunds, or a question, is skipped.
describe("help lines and reversals", () => {
  const AT3 = new Date("2026-11-12T06:30:00Z");
  const B = "Rs 615.00 debited from A/c XX8840 on 06-11-26 to PINE GROCER. ";
  const held = [
    "Refund processed, contact customer care for queries.",
    "Reversed on 07-11-26, call 18002345678",
    "Amount auto-reversed, call 18002345678 for details",
    "Refund successful, queries call 18002345678",
    "Reversed - call 18002345678 for details",
    "Credited back to your a/c, call 18002345678 for queries",
    "For the reversed amount call 18002345678.",
    "Reversal done, call 18002345678 for queries.",
    "Chargeback approved, contact us on 18002345678",
    "Cancelled by merchant, call 18002345678",
  ];
  const booked = [
    "For refunds or disputes call 18002345678.",
    "Not you? Call 18002345678 for reversal",
    "Know your refund status at lakeside.in/refund",
    "To raise a dispute call 18002345678.",
  ];
  for (const sender of [undefined, "VM-OTHRBK", "VM-HDFCBK-S"]) {
    it.each(held)(`${sender ?? "no sender"}: held: %s`, (tail) => {
      const p = parseCapture(B + tail, AT3, { sender });
      expect(p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE).toBe(false);
    });
    it.each(booked)(`${sender ?? "no sender"}: still booked: %s`, (tail) => {
      const p = parseCapture(B + tail, AT3, { sender });
      expect(p.kind === "money" && p.confidence >= CONFIDENCE_AUTO_CREATE).toBe(true);
    });
  }

  it("a card bill paid with a debit card carries the paid card's digits", () => {
    const p = parseCapture("Thank you for using your Debit Card XX8840 for Rs 12,300 payment towards Credit Card XX6047.", AT3);
    expect(p).toMatchObject({ kind: "money", cardPayment: true, last4: "6047" });
  });
});

describe("bank keys: Baroda Gramin is not Bank of Baroda", () => {
  it("reads a Gramin bank as no Bank of Baroda key", async () => {
    const { bankKeyOf } = await import("@/lib/capture/account-match");
    expect(bankKeyOf("Bank of Baroda")).toBe("BARODA");
    expect(bankKeyOf("Baroda UP Gramin Bank")).not.toBe("BARODA");
    expect(bankKeyOf("Baroda Rajasthan Gramin Bank")).not.toBe("BARODA");
  });
});
