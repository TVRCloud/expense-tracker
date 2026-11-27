import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("HDFC Bank parser", () => {
  readsAll({ sender: "VM-HDFCBK-S" }, [
    {
      name: "card spend: plain card digits and the shop after At",
      text: "Spent Rs.88.40 On HDFC Bank Card 5150 At ..PINE CORNER CAFE On 2026-10-03:07:52:19.Not You? To Block+Reissue Call 1800111222/SMS BLOCK CC 5150 to 7011122233",
      want: { parserId: "hdfc", type: "expense", amountMinor: 8840, last4: "5150", instrument: "card", merchant: "PINE CORNER CAFE" },
      auto: true,
    },
    {
      name: "card spend keeps a shop's own number",
      text: "Spent Rs.61.00 On HDFC Bank Card 5150 At ..CORNER STORE 24 On 2026-10-03:21:05:47.Not You? Call 1800111222",
      want: { parserId: "hdfc", merchant: "CORNER STORE 24" },
    },
    {
      name: "UPI debit",
      text: "Sent Rs.137.00 From HDFC Bank A/C *5150 To LOTUS PHARMACY On 03/10/26 Ref 604418827731 Not You? Call 1800111222/SMS BLOCK UPI to 7011122233",
      want: { parserId: "hdfc", type: "expense", amountMinor: 13700, last4: "5150", merchant: "LOTUS PHARMACY", ref: "604418827731" },
      auto: true,
    },
    {
      name: "UPI debit to a UPI id made of digits",
      text: "Sent Rs.31.00 From HDFC Bank A/C *5150 To 9700011122@ybl On 03/10/26 Ref 604418820001 Not You? Call 1800111222",
      want: { parserId: "hdfc", merchant: "9700011122@ybl" },
    },
    {
      name: "UPI credit from a VPA",
      text: "Rs.2215.00 credited to HDFC Bank A/c XX5150 on 03-10-26 from VPA meera.k@okhdfcbank (UPI 604477001234)",
      want: { parserId: "hdfc", type: "income", amountMinor: 221500, last4: "5150", merchant: "meera.k@okhdfcbank" },
      auto: true,
    },
    {
      name: "NEFT credit: the payer from inside the NEFT line",
      text: "Update! INR 18,640.00 deposited in HDFC Bank A/c XX5150 on 03-OCT-26 for NEFT Cr-WXYZ0004411-BRIGHTLEAF STUDIO-MEERA K-WXYZN26276000412.Avl bal INR 23,105.55. Cheque deposits in A/C are subject to clearing",
      want: { parserId: "hdfc", type: "income", amountMinor: 1864000, last4: "5150", merchant: "BRIGHTLEAF STUDIO" },
      auto: true,
    },
    {
      name: "NetBanking payment with no debit word",
      text: "Payment Successful! Rs. 1,316.75 from A/c ****5150 to GREENGRID ENERGY via HDFC Bank NetBanking. Not you?Call 1800111222",
      want: { parserId: "hdfc", type: "expense", amountMinor: 131675, last4: "5150", merchant: "GREENGRID ENERGY" },
      auto: true,
    },
    {
      name: "NetBanking payment to a credit card is a card bill payment",
      text: "Payment Successful! Rs. 7,250.00 from A/c ****5150 to HDFC Bank Credit Card XX6047 via HDFC Bank NetBanking.",
      want: { parserId: "hdfc", cardPayment: true },
      auto: false,
    },
    {
      name: "card reversal: the shop without its terminal code",
      text: "Transaction Reversed!On HDFC Bank CREDIT Card xx5150 Amt: Rs.245.60 By PAPERLEAF BOOKS 00017 On 2026-10-02:16:40:08",
      want: { parserId: "hdfc", type: "income", amountMinor: 24560, last4: "5150", merchant: "PAPERLEAF BOOKS" },
      auto: true,
    },
    {
      name: "ATM withdrawal has no shop",
      text: "Rs.3450 withdrawn from HDFC Bank A/c XX5150 at ATM KORAMANGALA on 03-10-26. Not you? Call 1800111222",
      want: { parserId: "hdfc", type: "expense", amountMinor: 345000, last4: "5150", atm: true, merchant: undefined },
    },
    {
      name: "a refund still to come stays in Review",
      text: "Refund initiated: Amt: Rs.2,075.00 on HDFC Bank Credit Card 5150. To receive your Refund,please update your Bank details: TnC.",
      want: { kind: "money" },
      auto: false,
    },
    {
      name: "a refund that will reflect later stays in Review",
      text: "Refund of Rs.410.00 initiated to HDFC Bank Card 5150 by GROCERYCO on 2026-10-02. It will reflect in 5-7 days.",
      want: { kind: "money" },
      auto: false,
    },
    {
      name: "a card bill payment received stays in Review",
      text: "Your HDFC Bank Credit Card 5150 payment of Rs.6,300.00 has been received on 03-10-26. Thank you.",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "money received towards the card is a card bill payment",
      text: "Received Rs.6300.00 towards your HDFC Bank Credit Card xx5150 on 03/10/26. Avl limit Rs.84,000",
      want: { cardPayment: true },
      auto: false,
    },
    {
      name: "an OTP is ignored",
      text: "730415 is your OTP for a txn of Rs 412.00 on HDFC Bank Card 5150 at PAPERLEAF. Valid 5 mins. Never share OTP with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
    {
      name: "a bill due notice is ignored",
      text: "New Bill Alert: Your GREENGRID Bill of Rs.2,860.00 is due on 18-Oct-2026. To pay, login to HDFC Bank NetBanking. Ignore if paid",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
