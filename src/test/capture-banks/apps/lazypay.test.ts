import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shapes LazyPay sends.
describe("LazyPay parser", () => {
  readsAll({ sender: "BP-LZYPAY-S" }, [
    {
      name: "a purchase on the pay-later line names the shop and its txn id (Review: no account)",
      text: "Your txn TXN5812640 of Rs. 236.40 on QUICKMART Private Limited was successful. Repay by 05-Dec.",
      want: { parserId: "lazypay", type: "expense", amountMinor: 23640, merchant: "QUICKMART Private Limited", ref: "TXN5812640", last4: undefined },
      auto: false,
    },
    {
      name: "a repayment is a card payment, never income",
      text: "Repayment of Rs. 1,480.00 towards your LazyPay dues received. Thank you.",
      want: { parserId: "lazypay", cardPayment: true, amountMinor: 148000 },
      auto: false,
    },
  ]);
});

describe("LazyPay: payments to LazyPay are repayments", () => {
  readsAll({ sender: "BP-LZYPAY-S" }, [
    {
      name: "a payment against the statement",
      text: "Thanks for your payment of Rs. 1,472.00 against your LazyPay statement.",
      want: { parserId: "lazypay", cardPayment: true, amountMinor: 147200 },
      auto: false,
    },
    {
      name: "a payment on LazyPay is never a purchase from a shop called LazyPay",
      text: "Your payment of Rs. 1,472.00 on LazyPay was successful.",
      want: { parserId: "lazypay", cardPayment: true, merchant: undefined },
      auto: false,
    },
  ]);
});
