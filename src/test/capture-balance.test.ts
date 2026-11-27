import { describe, expect, it } from "vitest";
import { createCaptureParser, parseCapture, type CaptureParse, type MessageSource } from "@/lib/capture/parsers";
import { findAvailableLimit, findBalance } from "@/lib/capture/parsers/extract/balance";

// Ticket 156: the balance and a card's available limit, kept on the parse. Every message is invented (fake amounts,
// digits and names) in the shape the bank sends; none is copied from another project.
const AT = new Date("2026-11-12T06:30:00Z");

const money = (p: CaptureParse) => {
  if (p.kind !== "money") throw new Error(`expected money, got ${p.kind}`);
  return p;
};
const read = (text: string, source?: MessageSource) => money(parseCapture(text, AT, source));

describe("findBalance and findAvailableLimit", () => {
  it.each([
    ["Avl Bal Rs.7,315.40", 731540],
    ["Avbl Bal: INR 2,08,416.75", 20841675],
    ["Available Balance is Rs. 9,061.00", 906100],
    ["New Bal :INR 3,318.20", 331820],
    ["Clr Bal Rs 640", 64000],
    ["Bal ₹1,19,204.33", 11920433],
    ["A/c Bal: 418.06", 41806],
    ["Avl bal:INR 72.5", 7250],
  ])("reads the balance in %s", (text, minor) => {
    expect(findBalance(text)).toBe(minor);
    expect(findAvailableLimit(text)).toBeUndefined();
  });

  it.each([
    ["Avl Lmt INR 1,73,902.00", 17390200],
    ["Avl Limit: INR 46,230.15", 4623015],
    ["Available Credit Limit Rs.88,000", 8800000],
    ["Avbl Limit: INR 5,410.70", 541070],
    ["Available limit is Rs.29,615.00.", 2961500],
  ])("reads the limit in %s", (text, minor) => {
    expect(findAvailableLimit(text)).toBe(minor);
    expect(findBalance(text)).toBeUndefined();
  });

  it.each([
    ["masked", "Avl bal: INR xxxxxx."],
    ["negative", "Avl Bal Rs.-1,240.00"],
    ["negative with a colon", "Bal: -1,240.00"],
    ["(-) sign", "Avl Bal INR (-)1,240.00"],
    ["overdrawn", "Avl Bal INR 1,240.00 Dr"],
    ["another currency", "Avl Bal USD 312.00"],
    ["a rule, not this balance", "Min Bal of Rs 5,000 not maintained"],
    ["a warning", "Insufficient balance Rs 126.00"],
    ["an average", "Average Balance Rs 10,400"],
    ["a date after the label", "Bal 12.11.26"],
    ["a bare whole number", "Bal 4821"],
    ["a merchant that starts with Bal", "paid to BALAJI STORES Rs 300"],
    ["nothing", "Rs 500 debited from A/c XX4821"],
  ])("leaves out a %s figure", (_name, text) => {
    expect(findBalance(text)).toBeUndefined();
    expect(findAvailableLimit(text)).toBeUndefined();
  });

  it("takes the first balance a message prints", () => {
    expect(findBalance("Avl Bal Rs 5,310.00. Clr Bal Rs 4,180.00")).toBe(531000);
  });
});

describe("parse: balance and limit per bank, never the amount", () => {
  const cases: { name: string; text: string; source: MessageSource; amount: number; balance?: number; limit?: number }[] = [
    {
      name: "HDFC UPI debit",
      text: "Sent Rs.212.40\nFrom HDFC Bank A/C *6230\nTo ORCHID FLOWERS\nOn 08/11/26\nRef 631800224466\nAvl bal:INR 18,422.05",
      source: { sender: "VM-HDFCBK-S" },
      amount: 21240,
      balance: 1842205,
    },
    {
      name: "HDFC card spend",
      text: "Spent Rs.1,045.00 On HDFC Bank Card 6230 At HILLTOP CAFE On 2026-11-08:19:02:11. Avl Lmt INR 2,14,377.60. Not You? Call 18001234567",
      source: { sender: "VM-HDFCBK-S" },
      amount: 104500,
      limit: 21437760,
    },
    {
      name: "ICICI account debit",
      text: "ICICI Bank Acct XX318 debited for Rs 760.00 on 08-Nov-26; RIVER MART credited. UPI:631800335577. Avl Bal Rs 31,906.12.",
      source: { sender: "AX-ICICIT-S" },
      amount: 76000,
      balance: 3190612,
    },
    {
      name: "ICICI card spend",
      text: "INR 2,380.00 spent using ICICI Bank Card XX7719 on 08-Nov-26 on NORTHWIND BOOKS. Avl Limit: INR 1,08,442.90. If not you, call 1800765432.",
      source: { sender: "AX-ICICIT-S" },
      amount: 238000,
      limit: 10844290,
    },
    {
      name: "SBI UPI debit",
      text: "Dear UPI user A/C X5408 debited by 145.0 on date 08Nov26 trf to TEA STALL Refno 631800446688. Avl Bal Rs 6,201.75. -SBI",
      source: { sender: "JD-SBIUPI-S" },
      amount: 14500,
      balance: 620175,
    },
    {
      name: "SBI card spend",
      text: "Rs.3,210.00 spent on your SBI Credit Card ending 4417 at GREENLEAF STORE on 08/11/26. Available Credit Limit Rs.61,890.00.",
      source: { sender: "VM-SBICRD-S" },
      amount: 321000,
      limit: 6189000,
    },
    {
      name: "Axis account debit",
      text: "INR 487.00 debited\nA/c no. XX660314\n08-11-26, 10:14:02\nUPI/P2M/631800557799/CITY GYM\nAvl bal: INR 9,880.45\nNot you? SMS BLOCKUPI Cust ID to 9000123456",
      source: { sender: "AX-AXISBK-S" },
      amount: 48700,
      balance: 988045,
    },
    {
      name: "Axis card spend",
      text: "Spent INR 820.00 Axis Bank Card no. XX3155 08-11-26 13:40:22 IST MOONLIGHT DINER Avl Limit: INR 47,315.00 Not you? SMS BLOCK 3155 to 9000123456",
      source: { sender: "AX-AXISBK-S" },
      amount: 82000,
      limit: 4731500,
    },
    {
      name: "Kotak UPI debit",
      text: "Sent Rs.330.00 from Kotak Bank AC X2290 to sunrise.store@ybl on 08-11-26.UPI Ref 631800668800. Bal:Rs.12,045.60",
      source: { sender: "JD-KOTAKB-S" },
      amount: 33000,
      balance: 1204560,
    },
    {
      name: "Kotak card spend",
      text: "INR 1,150.00 spent on Kotak Credit Card x8034 on 08-Nov-2026 at PINEWOOD MART. Avl limit INR 73,210.40.",
      source: { sender: "JD-KOTAKB-S" },
      amount: 115000,
      limit: 7321040,
    },
    {
      name: "IDFC FIRST debit",
      text: "Your A/C XXXXX6127 is debited by INR 274.00 on 08/11/26. New Bal :INR 4,733.10. Not you? Call 1800654321.",
      source: { sender: "BM-IDFCFB-S" },
      amount: 27400,
      balance: 473310,
    },
    {
      name: "IDFC FIRST card spend (exact format)",
      text: "Happy Shopping! INR 1,640.00 spent on your IDFC FIRST Bank Credit Card ending XX5260 at LAKE VIEW HOTEL on 08 NOV 2026 at 08:15 PM. Avbl Limit: INR 92,104.50",
      source: { sender: "BM-IDFCFB-S" },
      amount: 164000,
      limit: 9210450,
    },
    {
      name: "a bank with no parser of its own",
      text: "Rs 2,060.00 credited to A/c XX9921 on 08-11-26 by NEFT from MAPLE TRADERS. Avl Bal Rs 26,500.00",
      source: { sender: "VM-OTHRBK" },
      amount: 206000,
      balance: 2650000,
    },
  ];

  it.each(cases)("$name", ({ text, source, amount, balance, limit }) => {
    const p = read(text, source);
    expect(p.amountMinor).toBe(amount);
    expect(p.balanceMinor).toBe(balance);
    expect(p.availableLimitMinor).toBe(limit);
  });

  it("reads the amount, not a balance printed before it", () => {
    const p = read("Avl Bal Rs 8,412.30 after Rs 540.00 debited from A/c XX4821 on 08-11-26 to VPA milk.man@ybl", {
      sender: "VM-OTHRBK",
    });
    expect(p).toMatchObject({ amountMinor: 54000, balanceMinor: 841230, type: "expense" });
  });

  it("keeps an INR limit on a spend abroad, and the spend in its own currency", () => {
    const p = read("Spent USD 18.40 on HDFC Bank Card 6230 At CLOUDNOTES On 2026-11-08:07:11:05. Avl Lmt INR 1,90,005.00", {
      sender: "VM-HDFCBK-S",
    });
    expect(p).toMatchObject({ currency: "USD", amountMinor: 1840, availableLimitMinor: 19000500 });
    expect(p.confidence).toBeLessThanOrEqual(0.6);
  });

  it("leaves out an overdrawn balance and a masked one", () => {
    expect(read("Rs 310.00 debited from A/c XX4821 on 08-11-26 to VPA bus.pass@ybl. Avl Bal INR 1,260.00 Dr", {}).balanceMinor).toBeUndefined();
    expect(
      read("INR 83.00 debited\nA/c no. XX660314\n08-11-26, 10:14:02\nUPI/P2M/631800557700/KIOSK\nAvl bal: INR xxxxxx", {
        sender: "AX-AXISBK-S",
      }).balanceMinor
    ).toBeUndefined();
  });

  it("a message that only states a balance is not money", () => {
    for (const sender of ["VM-HDFCBK-S", "JD-SBIINB-S", "VM-OTHRBK", undefined]) {
      const p = parseCapture("Dear Customer, the balance in your A/c XX4821 as on 08-11-26 is Avl Bal Rs 12,500.00.", AT, { sender });
      expect(p.kind).not.toBe("money");
    }
  });

  it("adds no confidence: the same message with and without its balance scores the same", () => {
    const generic = createCaptureParser([]);
    const base = "Rs 540.00 debited from A/c XX4821 on 08-11-26 to VPA milk.man@ybl. Ref 631800779911";
    for (const sender of ["VM-HDFCBK-S", "AX-ICICIT-S", "JD-SBIINB-S", "AX-AXISBK-S", "JD-KOTAKB-S", "BM-IDFCFB-S", "VM-OTHRBK"]) {
      const plain = parseCapture(base, AT, { sender });
      const withBal = parseCapture(`${base}. Avl Bal Rs 9,050.00`, AT, { sender });
      expect(withBal.confidence).toBe(plain.confidence);
    }
    expect(generic(`${base}. Avl Lmt INR 9,050.00`, AT).confidence).toBe(generic(base, AT).confidence);
  });

  it("a balance or a limit is never stored when the parse is not money", () => {
    const p = parseCapture("Your OTP is 730518. Avl Bal Rs 9,050.00", AT, { sender: "VM-HDFCBK-S" });
    expect(p.kind).toBe("ignored");
    expect(p).not.toHaveProperty("balanceMinor");
  });

  it("reads a long, padded balance or limit line quickly", () => {
    const pads = [
      `Rs 5 debited A/c XX4821 Avl Bal${" ".repeat(5000)}Rs 5`,
      `Rs 5 debited A/c XX4821 ${"Avl Bal ".repeat(700)}`,
      `Rs 5 debited A/c XX4821 Avl Lmt${":".repeat(5000)}INR 5`,
      `Rs 5 debited A/c XX4821 Bal ${"1,".repeat(2500)}`,
      `Rs 5 debited A/c XX4821 ${"Min Bal ".repeat(700)}Rs 5`,
    ];
    for (const sender of ["VM-HDFCBK-S", "AX-ICICIT-S", "JD-SBIINB-S", "AX-AXISBK-S", "JD-KOTAKB-S", "BM-IDFCFB-S", undefined]) {
      for (const text of pads) {
        const start = performance.now();
        parseCapture(text, AT, { sender });
        expect(performance.now() - start).toBeLessThan(250);
      }
    }
  });
});

describe("review of ticket 156: figures that are not this account's money", () => {
  // 1: a figure printed next to other digits, or on a card bill payment, is not the account in last4's.
  it("leaves out a balance on a card bill payment (it could be either account's)", () => {
    const p = read(
      "Rs 4,180.00 debited from A/c XX7305 on 03-11-26 towards HDFC Bank Credit Card XX2614. Avl Bal Rs 18,306.00",
      { sender: "VM-HDFCBK-S" }
    );
    expect(p).toMatchObject({ cardPayment: true });
    expect(p.balanceMinor).toBeUndefined();
  });

  it("leaves out a balance printed next to another account's digits", () => {
    const p = read("Rs 615.00 transferred from A/c XX7305 to A/c XX8842 on 08-11-26. A/c XX8842 Avl Bal Rs 340.00", {
      sender: "VM-OTHRBK",
    });
    expect(p.last4).toBe("7305");
    expect(p.balanceMinor).toBeUndefined();
  });

  it("keeps a balance printed next to the account's own digits, and a 3-digit mask that ends the same", () => {
    expect(read("Rs 615.00 debited from A/c XX7305 on 08-11-26 to VPA fruit.cart@ybl. A/c XX7305 Avl Bal Rs 340.00", {}).balanceMinor).toBe(34000);
    expect(
      read("ICICI Bank Acct XX305 debited for Rs 615.00 on 08-Nov-26; FRUIT CART credited. Acct XX7305 Avl Bal Rs 340.00", {
        sender: "AX-ICICIT-S",
      }).balanceMinor
    ).toBe(34000);
  });

  it("keeps a limit only for a card, and only that card's", () => {
    expect(read("Rs 615.00 debited from A/c XX7305 on 08-11-26 to VPA fruit.cart@ybl. Avl Lmt Rs 40,250.00", {}).availableLimitMinor).toBeUndefined();
    expect(
      read("Rs 615.00 spent on card XX2614 at FRUIT CART on 08-11-26. Card XX9930 Avl Lmt Rs 40,250.00", {}).availableLimitMinor
    ).toBeUndefined();
    expect(read("Rs 615.00 spent on card XX2614 at FRUIT CART on 08-11-26. Avl Lmt Rs 40,250.00", {}).availableLimitMinor).toBe(4025000);
  });

  it.each([
    // 2: a rule or warning with a word before "Bal".
    "Min Avl Bal Rs 12,250.00 not maintained",
    "Min. Avl Bal Rs 12,250.00",
    "Insufficient Avl Bal Rs 14.00",
    "Low Avl Bal Rs 86.00 - top up",
    // 3: not the account's own money, or money still to move.
    "Outstanding Bal Rs 11,640.00",
    "Total outstanding balance Rs 11,640.00",
    "Total Bal Rs 11,640.00",
    "Current Bal Rs 11,640.00",
    "Loan Bal Rs 1,18,300.00",
    "Principal Balance Rs 1,18,300.00",
    "Cashback balance Rs 236.00",
    "Wallet Bal Rs 236.00",
    "FASTag Bal Rs 236.00",
    "NCMC card bal Rs 82.00",
    "Reward points balance: 1,348.00",
    "Loyalty points bal 1,348.50",
    "Bal of Rs 1,060.00 will be debited on 15-11",
    "Balance Rs 1,060.00 to be paid",
    "Balance Rs 1,060.00 due",
    "Bal Rs 1,060.00 payable",
    // 4: overdrawn written after the figure.
    "Avl Bal: Rs 236.00 (Dr)",
    "Avl Bal: Rs.236.00(-)",
    "Avl Bal Rs 236.00-",
    // 6: a bare "Bal" with no currency (a shop name).
    "spent at GLOBAL BAL 13.70 on card",
    // 7: too large to be a balance.
    "Avl Bal Rs 999999999999999.99",
    // garbled grouping
    "Avl Bal Rs 2,36.00",
  ])("leaves out the balance in %s", (text) => {
    expect(findBalance(text)).toBeUndefined();
  });

  it.each(["Daily Avl Limit Rs 9,615.00 on Debit Card", "ATM Avl Lmt Rs 9,615.00", "Avl Cash Limit Rs 9,615.00", "UPI Avl Limit Rs 9,615.00"])(
    // 5: a daily, cash, ATM or UPI limit is not the card's credit limit.
    "leaves out the limit in %s",
    (text) => {
      expect(findAvailableLimit(text)).toBeUndefined();
    }
  );

  it.each([
    // 4: ":-" is a separator, and "-SBI" after the figure is a signature, not a minus.
    ["Avl Bal:-Rs 236.00", 23600],
    ["Avl Bal Rs 236.00-SBI", 23600],
    // 8: "is now".
    ["Available balance is now Rs 1,060.00", 106000],
    // A later real balance after a rule is still read.
    ["Min Bal charges of Rs 515.00 debited. Avl Bal Rs 2,318.00", 231800],
    ["Bal Rs 236, thanks", 23600],
  ])("still reads %s", (text, minor) => {
    expect(findBalance(text)).toBe(minor);
  });

  it("reads the credit limit, not a cash limit printed first", () => {
    expect(findAvailableLimit("Available Cash Limit: Rs 8,150.00; Available Credit Limit: Rs 41,300.00")).toBe(4130000);
  });
});

describe("review of ticket 156, round 2", () => {
  const SENDERS = ["VM-HDFCBK-S", "AX-ICICIT-S", "JD-SBIINB-S", "AX-AXISBK-S", "JD-KOTAKB-S", "BM-IDFCFB-S", undefined];

  // 1: a word that ends the sentence before never vetoes the next label.
  it.each([
    ["Rs 615.00 debited from A/c XX7305 for Loan EMI. Avl Bal: INR 6,140.00", 614000, undefined],
    ["Rs 615.00 debited from A/c XX7305 to Paytm Wallet. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 debited from A/c XX7305 towards loan. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 debited from A/c XX7305 towards Prepaid. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 credited to A/c XX7305 as cashback. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 debited from A/c XX7305 for gift. Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 debited from A/c XX7305 at Current. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 spent on Debit Card XX7305. Avl Bal Rs 6,140.00", 614000, undefined],
    ["Rs 615.00 spent on card XX2614 at ONLINE. Avl Lmt Rs 41,270.00", undefined, 4127000],
    ["Rs 615.00 spent on card XX2614 at ATM. Avl Lmt Rs 41,270.00", undefined, 4127000],
  ])("reads the figure after %s for every sender", (text, balance, limit) => {
    for (const sender of SENDERS) {
      const p = read(text, { sender });
      expect(p.balanceMinor).toBe(balance);
      expect(p.availableLimitMinor).toBe(limit);
    }
  });

  it.each(["Loan Bal Rs 1,16,400.00", "Min. Avl Bal Rs 12,250.00", "Min.Avl Bal Rs 12,250.00", "Txn. Avl Limit Rs 9,615.00"])(
    "still leaves out %s",
    (text) => {
      expect(findBalance(text) ?? findAvailableLimit(text)).toBeUndefined();
    }
  );

  // 2: digits from the sentence before, or out of a reference, never name another owner.
  it.each([
    ["IMPS INR 615.00 sent from HDFC Bank A/c XX7305 on 08-11-26 To A/c xxxxxxxx8842. Avl bal:INR 6,140.00", "VM-HDFCBK-S"],
    ["Rs 615.00 debited from A/c XX7305 to A/c XX8842. Avl Bal Rs 6,140.00", "VM-OTHRBK"],
    ["Rs 615.00 debited from A/c XX7305 on 08-11-26 Ref 631800XX8842 Avl Bal Rs 6,140.00", "VM-OTHRBK"],
  ])("keeps the payer's balance in %s", (text, sender) => {
    const p = read(text, { sender });
    expect(p.last4).toBe("7305");
    expect(p.balanceMinor).toBe(614000);
  });

  it("still drops a balance printed next to other digits in the same clause", () => {
    expect(read("Rs 615.00 debited from A/c XX7305 to A/c XX8842 on 08-11-26, A/c XX8842 Avl Bal Rs 340.00", {}).balanceMinor).toBeUndefined();
  });

  // 3: two accounts in one message: an expense is the payer's account, for every sender.
  it("an expense with a credited account in the same message is booked on the payer's account", () => {
    const messages = [
      "Your a/c no. XXXXXXXX7305 is debited for Rs.615.00 on 08-11-26 and a/c XXXXXX8842 credited (IMPS Ref no 631800224411). Avl Bal Rs 2,940.00",
      "Rs 615.00 debited from A/c XX7305 and credited to A/c XX8842 on 08-11-26. Ref 631800224411",
      "A/c XX7305 debited by Rs 615.00 on 08-11-26; A/c XX8842 credited. Ref 631800224411",
    ];
    for (const text of messages) {
      for (const sender of SENDERS) {
        expect(read(text, { sender })).toMatchObject({ type: "expense", last4: "7305" });
      }
      expect(money(createCaptureParser([])(text, AT))).toMatchObject({ type: "expense", last4: "7305" });
    }
  });

  it("income names the credited account", () => {
    for (const sender of SENDERS) {
      expect(
        read("Your A/c XXXXX7305 is credited by Rs.615.00 on 08-11-26 from a/c XXXXXX8842 (IMPS Ref no 631800224411)", { sender })
      ).toMatchObject({ type: "income", last4: "7305" });
    }
  });

  // 4-7
  it.each([
    ["Avl Bal Rs 6,140.00 due to a reversal", 614000],
    ["Avl Bal Rs 6,140.00- HDFC Bank", 614000],
    ["Avl Bal Rs 6,140.00, Rs 115.00 on hold", 614000],
  ])("reads %s", (text, minor) => {
    expect(findBalance(text)).toBe(minor);
  });

  it.each(["Avl Bal Rs 6,140.00-.", "Avl Bal Rs 6,140.00-", "UPI Lite Bal Rs 236.00", "Balance Rs 1,060.00 due on 15-11"])(
    "leaves out %s",
    (text) => {
      expect(findBalance(text)).toBeUndefined();
    }
  );
});
