import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, parseCapture, type CaptureParse } from "@/lib/capture/parsers";
import { readsAll, RECEIVED } from "../helpers";

// Ticket 172 review: tricky messages written in each bank's own shapes (two masks, a card and an account in one
// message, Info text that contradicts the bank's token). Invented values only.
const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};

describe("IndusInd: two partly shown accounts", () => {
  readsAll({ sender: "VM-INDUSB-S" }, [
    {
      name: "IMPS to another account keeps the person's account",
      text: "IMPS of INR 1,140 to Account 62XXXXXX8019 debited from your A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 114000, last4: "3386" },
    },
    {
      name: "IMPS from another account keeps the person's account",
      text: "IMPS of INR 1,140 received from Account 62XXXXXX8019 in your A/C 207***003386 - IndusInd Bank",
      want: { type: "income", amountMinor: 114000, last4: "3386" },
    },
    {
      name: "an RD instalment is money out of the savings account",
      text: "Your RD A/C 520***778104 debited for INR 2,750 instalment from your A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 275000, last4: "3386" },
    },
    {
      name: "an RD credited by debit to the savings account is money out of it",
      text: "INR 2,750 credited to your RD A/C 520***778104 by debit to A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 275000, last4: "3386" },
    },
    {
      name: "a new FD booked from the savings account is money out of it",
      text: "Your FD A/C 520***778104 has been credited for INR 35,000 towards new deposit booking from A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 3500000, last4: "3386" },
    },
    {
      name: "an FD closure names no payee (never the deposit number)",
      text: "Your IndusInd Account 15XXXXX3386 has been credited for INR 35,000 towards FD closure 520***778104 - IndusInd Bank",
      want: { type: "income", amountMinor: 3500000, last4: "3386", merchant: undefined },
    },
    {
      name: "tax on deposit interest is not interest paid in",
      text: "TDS of INR 13.70 deducted on interest paid on your IndusInd Deposit No 520***778104 - IndusInd Bank",
      want: { type: "expense" },
      auto: false,
    },
    {
      name: "an ACH debit to a card names the card issuer without the card number",
      text: "IndusInd A/C Debited; INR 6,280.00 Ref-ACH DR INW PAY/0000ZXCV0987/HDFC CC 4492.Bal INR 3,310.40.Dispute-Call 0000000000-IndusInd Bank.",
      want: { type: "expense", merchant: "HDFC CC" },
    },
  ]);
});

describe("a card the message only mentions never replaces the account the money left or reached", () => {
  readsAll({}, [
    {
      name: "Federal: debit card fee",
      source: { sender: "VM-FEDBNK-S" },
      text: "Rs 472.00 debited from a/c X4127 on 07Nov26 towards Federal Bank Debit Card 9058 annual fee. Bal Rs 2,815.60 -Federal Bank",
      want: { type: "expense", last4: "4127", instrument: "account", merchant: undefined },
    },
    {
      name: "Federal: refund from a card into the account",
      source: { sender: "VM-FEDBNK-S" },
      text: "Rs 3,150.00 credited to your A/c XX4127 via NEFT on 07NOV2026 from Federal Bank Credit Card 9058 excess refund -Federal Bank",
      want: { type: "income", last4: "4127", instrument: "account" },
    },
    {
      name: "YES BANK: debit card fee",
      source: { sender: "VM-YESBNK-S" },
      text: "INR 472.00 debited from A/c XX4127 on 07-11-2026 for YES BANK Debit Card X9058 annual fee. Avl Bal INR 1,920.00",
      want: { type: "expense", last4: "4127", instrument: "account" },
    },
    {
      name: "IndusInd: debit card fee",
      source: { sender: "VM-INDUSB-S" },
      text: "INR 472.00 debited from A/c XX4127 for IndusInd Debit Card XX9058 annual fee on 07-11-2026 - IndusInd Bank",
      want: { type: "expense", last4: "4127", instrument: "account" },
    },
  ]);
});

describe("South Indian: the bank's own token decides, whatever the Info text says", () => {
  readsAll({ sender: "AD-SIBSMS-S" }, [
    {
      name: "a credit whose Info says 'Paid via'",
      text: "UPI Credit:INR Rs.1,375.00 in A/c X8846. Info: UPI/HDFC/631066611111/ Paid via GPay on 07-11-26 18:02:11.Final balance is Rs.6,240.00 -South Indian Bank",
      want: { type: "income", amountMinor: 137500, last4: "8846" },
      auto: true,
    },
    {
      name: "a credit whose Info says 'SENT BY'",
      text: "UPI Credit:INR Rs.1,375.00 in A/c X8846. Info: UPI/HDFC/631066611111/ SENT BY MANU on 07-11-26 18:02:11.Final balance is Rs.6,240.00 -South Indian Bank",
      want: { type: "income" },
    },
    {
      name: "a debit whose Info says 'Received with thanks'",
      text: "UPI debit:INR Rs.315.00 in A/c X8846. Info:UPI/ICIC/631066622222/Received with thanks on 07-11-26 20:17:43. Final balance is Rs.5,925.00 -South Indian Bank",
      want: { type: "expense", amountMinor: 31500, last4: "8846" },
      auto: true,
    },
    {
      name: "a debit whose Info says 'rent credited'",
      text: "UPI debit:INR Rs.315.00 in A/c X8846. Info:UPI/ICIC/631066622222/rent credited on 07-11-26 20:17:43. Final balance is Rs.5,925.00 -South Indian Bank",
      want: { type: "expense" },
    },
    {
      name: "a debit whose payee is a UPI id made of digits keeps it whole",
      text: "UPI debit:INR Rs.86.00 in A/c X8846. Info:UPI/UTIB/631066633333/9746011223@ybl on 07-11-26 20:17:43. Final balance is Rs.5,839.00 -South Indian Bank",
      want: { type: "expense", merchant: "9746011223@ybl" },
    },
    {
      name: "a one-X code in front of a name stays (it may be part of the name, like X1000 FITNESS)",
      text: "A/c X8846 DEBIT:Rs.940.00 X6634 SUNIL MCT Bal:Rs.4,899.00 -South Indian Bank",
      want: { type: "expense", merchant: "X6634 SUNIL" },
    },
    {
      name: "a card bill paid from the account is a card payment",
      text: "A/c X8846 DEBIT:Rs.5,715.00 CC PAYMENT SIB CARD MCT Bal:Rs.1,210.00 -South Indian Bank",
      want: { cardPayment: true, merchant: undefined },
      auto: false,
    },
  ]);

  it.each([
    "Your A/c X8846 balance is Rs.7,120.00 as on 07-11-26. Last debit:Rs.296.00 on 06-11-26 -South Indian Bank",
    "Cheque No 007741 for debit:Rs.10,400.00 returned unpaid A/c X8846 -South Indian Bank",
    "Hold debit:Rs.380.00 placed on A/c X8846 for card pre-authorisation at FUEL STOP -South Indian Bank",
    "UPI debit:Rs.296.00 A/c X8846 reversed on 07-11-26 RRN: 631066644444 -South Indian Bank",
  ])("is never booked as spending: %s", (text) => {
    const p = parseCapture(text, RECEIVED, { sender: "AD-SIBSMS-S" });
    if (p.kind === "money" && p.type === "expense") expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
  });
});

describe("names never carry references, masks or card numbers", () => {
  it("Kerala Bank: a reference glued before a UPI id", () => {
    const p = money(
      parseCapture(
        "Dear Customer Your A/c no XXXX3390 is debited with 415.00 on 07-11-2026 by UPI To : 631099887766/greenbasket@okaxis. Balance is 2210.00 - Kerala Bank",
        RECEIVED,
        { sender: "VM-KELBNK-S" }
      )
    );
    expect(p.merchant).toBe("greenbasket@okaxis");
  });

  it("Saraswat: a card number and a reference after ACH", () => {
    const card = money(
      parseCapture("Your A/c no. 3390 is debited with INR 6,050.00 on 07-11-2026 towards ACH Debit:ICICI CC 4492. Current Bal is INR 1,180.00 CR - Saraswat Bank", RECEIVED, {
        sender: "VM-SARBNK-S",
      })
    );
    expect(card.merchant).toBe("ICICI CC");
    const sip = money(
      parseCapture("Your A/c no. 3390 is debited with INR 1,560.00 on 07-11-2026 towards ACH Debit:LOTUSFUND SIP 774102. Current Bal is INR 1,180.00 CR - Saraswat Bank", RECEIVED, {
        sender: "VM-SARBNK-S",
      })
    );
    expect(sip.merchant).toBe("LOTUSFUND SIP");
  });
});

describe("a debit the message says was undone stays in Review", () => {
  readsAll({ sender: "VM-KBLBNK-S" }, [
    {
      name: "Karnataka: debited ... has been reversed",
      text: "Your a/c XX3390 debited for Rs.265.00 on 07-11-26 trf to RIVER VIEW MART has been reversed. -KarnatakaBank",
      want: { type: "expense" },
      auto: false,
    },
  ]);

  it("Kerala Bank: only a loan recovery credit is held, never a debit", () => {
    const debit = money(
      parseCapture("Dear Customer Your A/c no XXXX3390 is debited with 2460.00 on 07-11-2026 by Loan Recovery To : EMI 07. Balance is 1810.00 - Kerala Bank", RECEIVED, {
        sender: "VM-KELBNK-S",
      })
    );
    expect(debit.type).toBe("expense");
    expect(debit.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
  });
});

// Ticket 172 review, round 2.
describe("IndusInd: the person's own account wins over a beneficiary's", () => {
  readsAll({ sender: "VM-INDUSB-S" }, [
    {
      name: "own account leads, beneficiary partly shown",
      text: "A/c *XX3386 debited by Rs 1,265.00 towards IMPS to Account 71XXXXXX5072. RRN: 631088221144. Not You? call 0000000000- IndusInd Bank.",
      want: { type: "expense", last4: "3386" },
    },
    {
      name: "own account leads a credit from a partly shown account",
      text: "A/c *XX3386 credited by Rs 1,265.00 from Account 71XXXXXX5072 via IMPS. RRN: 631088221144.- IndusInd Bank.",
      want: { type: "income", last4: "3386" },
    },
    {
      name: "the verb decides over 'your' with two partly shown accounts",
      text: "IMPS of INR 1,265 to your Account 71XXXXXX5072 at AXIS Bank debited from A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", last4: "3386" },
    },
    {
      name: "a spelled-out Recurring Deposit funded from savings is money out of savings",
      text: "INR 4,350 credited to your Recurring Deposit A/C 520***778104 by debit to A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 435000, last4: "3386" },
    },
  ]);

  it("never names the bank the verb runs into as the payee", () => {
    const p = money(
      parseCapture("IMPS of INR 1,265 to your Account 71XXXXXX5072 at AXIS Bank debited from A/C 207***003386 - IndusInd Bank", RECEIVED, {
        sender: "VM-INDUSB-S",
      })
    );
    expect(p.merchant ?? "").not.toMatch(/debited/i);
  });
});

describe("South Indian: a token inside the Info text never decides", () => {
  readsAll({ sender: "AD-SIBSMS-S" }, [
    {
      name: "a credit whose Info says 'debit:'",
      text: "Dear Customer, Your A/c X8846 is credited with Rs.2,730.00 Info: IMPS/HDFC/631066655555/ debit:Rs.2730 adj. Final balance is Rs.7,210.00-South Indian Bank",
      want: { type: "income", amountMinor: 273000 },
    },
    {
      name: "a UPI credit whose Info says 'debit:'",
      text: "UPI Credit:INR Rs.1,375.00 in A/c X8846. Info: UPI/HDFC/631066611111/ debit:Rs.1375 memo on 07-11-26.Final balance is Rs.6,240.00 -South Indian Bank",
      want: { type: "income" },
    },
    {
      name: "a bank's CC PAYMENT is a card payment",
      text: "A/c X8846 DEBIT:Rs.5,715.00 SIB CC PAYMENT MCT Bal:Rs.1,210.00 -South Indian Bank",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "a shop called '... CC PAYMENT SOLUTIONS' is a spend",
      text: "A/c X8846 DEBIT:Rs.715.00 KAPPA CC PAYMENT SOLUTIONS MCT Bal:Rs.1,210.00 -South Indian Bank",
      want: { type: "expense", merchant: "KAPPA CC PAYMENT SOLUTIONS" },
      auto: true,
    },
  ]);
});

describe("names with numbers that are part of the name stay whole", () => {
  readsAll({ sender: "AD-SIBSMS-S" }, [
    { name: "X200 TELECOM", text: "A/c X8846 DEBIT:Rs.715.00 X200 TELECOM MCT Bal:Rs.1,210.00 -South Indian Bank", want: { merchant: "X200 TELECOM" } },
  ]);
  readsAll({ sender: "VM-KELBNK-S" }, [
    {
      name: "8x10 FRAMES",
      text: "Dear Customer Your A/c no XXXX3390 is debited with 415.00 on 07-11-2026 by UPI To : 8x10 FRAMES. Balance is 2210.00 - Kerala Bank",
      want: { merchant: "8x10 FRAMES" },
    },
    {
      // Accepted noise (phase 9 decision): any undo word anywhere sends a debit to Review, a payee's name included.
      name: "a payee whose name says reversal goes to Review",
      text: "Dear Customer Your A/c no XXXX3390 is debited with 415.00 on 07-11-2026 by UPI To : REVERSAL BAKERY. Balance is 2210.00 - Kerala Bank",
      want: { type: "expense", merchant: "REVERSAL BAKERY" },
      auto: false,
    },
  ]);
});

describe("Federal: an e-mandate card payment keeps its card", () => {
  readsAll({ sender: "VM-FEDBNK-S" }, [
    {
      name: "'Amount debited from account linked' names no account",
      text: "Hi, payment of INR 236.00 for MusicBox via e-mandate ID: MB22LKJH7741 on Federal Bank Credit Card 9058 is processed successfully. Amount debited from account linked to the card. - Federal Bank",
      want: { type: "expense", last4: "9058", instrument: "card", merchant: "MusicBox" },
    },
  ]);
});

// Ticket 172 review, round 3.
describe("IndusInd: the account written as the person's own paid, whatever account 'credited' names", () => {
  readsAll({ sender: "VM-INDUSB-S" }, [
    {
      name: "credited to another account by debit from yours",
      text: "INR 1,265 credited to A/C 71XXXXXX5072 by debit from your A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", amountMinor: 126500, last4: "3386" },
    },
    {
      name: "another account has been credited from yours",
      text: "Account 71XXXXXX5072 has been credited with INR 1,265 from your A/C 207***003386 - IndusInd Bank",
      want: { type: "expense", last4: "3386" },
    },
    {
      name: "received in another account from yours",
      text: "INR 1,265 received in A/C 71XXXXXX5072 from your A/C 207***003386 via IMPS - IndusInd Bank",
      want: { type: "expense", last4: "3386" },
    },
    {
      name: "sent from another account to yours is income",
      text: "INR 1,265 sent from Account 71XXXXXX5072 to your A/C 207***003386 credited via IMPS - IndusInd Bank",
      want: { type: "income", last4: "3386" },
    },
    {
      name: "a card bill paid from the account linked to the card",
      text: "INR 9,850 debited from your account linked for IndusInd Credit Card XX4417 payment - IndusInd Bank",
      want: { cardPayment: true, last4: "4417", instrument: "card" },
      auto: false,
    },
  ]);
});

describe("South Indian: Info in any spelling, CC PAYMENT after an RRN, a one-X name", () => {
  readsAll({ sender: "AD-SIBSMS-S" }, [
    {
      name: "'Info :' with a space",
      text: "Dear Customer, Your A/c X8846 is credited with Rs.2,730.00 Info : IMPS/HDFC/631066655555/ debit:Rs.2730 adj. Final balance is Rs.7,210.00-South Indian Bank",
      want: { type: "income" },
    },
    {
      name: "'Remarks:'",
      text: "Dear Customer, Your A/c X8846 is credited with Rs.2,730.00 Remarks: debit:Rs.2730 adj. Final balance is Rs.7,210.00-South Indian Bank",
      want: { type: "income" },
    },
    {
      name: "the leading token wins over a later one",
      text: "UPI Credit:INR Rs.1,375.00 in A/c X8846 07-11-26 RRN: 631066611111 note debit:Rs.1375 back -South Indian Bank",
      want: { type: "income" },
    },
    {
      name: "a UPI debit with CC PAYMENT after the RRN is a card payment",
      text: "UPI debit:Rs.5,715.00 A/c X8846, 07-11-26 RRN: 631066677777 CC PAYMENT Bal:Rs.1,210.00 -South Indian Bank",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "a refund word in the Info text sends a debit to Review",
      text: "UPI debit:INR Rs.315.00 in A/c X8846. Info:UPI/ICIC/631066622222/ Refunded thanks on 07-11-26. Final balance is Rs.5,925.00 -South Indian Bank",
      want: { type: "expense" },
      auto: false,
    },
    { name: "X2000 GYM stays whole", text: "A/c X8846 DEBIT:Rs.715.00 X2000 GYM MCT Bal:Rs.1,210.00 -South Indian Bank", want: { merchant: "X2000 GYM" } },
  ]);
});

describe("an undo word anywhere sends a debit to Review", () => {
  readsAll({}, [
    {
      name: "Karnataka: '... reversed.' after the payee",
      source: { sender: "VM-KBLBNK-S" },
      text: "Your a/c XX3390 debited for Rs.265.00 on 07-11-26 trf to LAKE VIEW reversed. UPI:6*********55 -KarnatakaBank",
      want: { type: "expense" },
      auto: false,
    },
    {
      name: "Kerala Bank: '... has been reversed.'",
      source: { sender: "VM-KELBNK-S" },
      text: "Dear Customer Your A/c no XXXX3390 is debited with 415.00 on 07-11-2026 by UPI To : GREENBASKET has been reversed. Balance is 2210.00 - Kerala Bank",
      want: { type: "expense" },
      auto: false,
    },
    {
      name: "Saraswat: an ACH debit returned unpaid",
      source: { sender: "VM-SARBNK-S" },
      text: "Your A/c no. 3390 is debited with INR 615.00 on 07-11-2026 towards ACH Debit:BRIGHTGRID RETURNED UNPAID. Current Bal is INR 1,180.00 CR - Saraswat Bank",
      want: { type: "expense" },
      auto: false,
    },
  ]);
});
