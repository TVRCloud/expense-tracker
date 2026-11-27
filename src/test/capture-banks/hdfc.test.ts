import { describe } from "vitest";
import { readsAll } from "./helpers";

describe("HDFC Bank parser", () => {
  readsAll({ sender: "VM-HDFCBK-S" }, [
    {
      name: "card spend: plain card digits and the shop after At",
      text: "Spent Rs.1,249.50 On HDFC Bank Card 4821 At ..BLUE TOKAI COFFEE On 2026-11-12:09:14:03.Not You? To Block+Reissue Call 1800000000/SMS BLOCK CC 4821 to 7000000000",
      want: { parserId: "hdfc", type: "expense", amountMinor: 124950, last4: "4821", instrument: "card", merchant: "BLUE TOKAI COFFEE" },
      auto: true,
    },
    {
      name: "UPI debit",
      text: "Sent Rs.320.00 From HDFC Bank A/C *4821 To RAJ STORES On 12/11/26 Ref 631298765432 Not You? Call 1800000000/SMS BLOCK UPI to 7000000000",
      want: { parserId: "hdfc", type: "expense", amountMinor: 32000, last4: "4821", merchant: "RAJ STORES", ref: "631298765432" },
      auto: true,
    },
    {
      name: "UPI credit from a VPA",
      text: "Rs.1500.00 credited to HDFC Bank A/c XX4821 on 12-11-26 from VPA asha.r@okicici (UPI 631255554444)",
      want: { parserId: "hdfc", type: "income", amountMinor: 150000, last4: "4821", merchant: "asha.r@okicici" },
      auto: true,
    },
    {
      name: "NEFT credit: the payer from inside the NEFT line",
      text: "Update! INR 42,000.00 deposited in HDFC Bank A/c XX4821 on 12-NOV-26 for NEFT Cr-ABCD0001234-NORTHWIND TRADERS-ASHA RAO-ABCDN26316000001.Avl bal INR 50,000.00. Cheque deposits in A/C are subject to clearing",
      want: { parserId: "hdfc", type: "income", amountMinor: 4200000, last4: "4821", merchant: "NORTHWIND TRADERS" },
      auto: true,
    },
    {
      name: "NetBanking payment with no debit word",
      text: "Payment Successful! Rs. 2,400.00 from A/c ****4821 to CITY POWER LTD via HDFC Bank NetBanking. Not you?Call 1800000000",
      want: { parserId: "hdfc", type: "expense", amountMinor: 240000, last4: "4821", merchant: "CITY POWER LTD" },
      auto: true,
    },
    {
      name: "card reversal: the shop without its terminal number",
      text: "Transaction Reversed!On HDFC Bank CREDIT Card xx4821 Amt: Rs.799.00 By NORTHWIND SHOP     000 On 2026-11-12:10:02:11",
      want: { parserId: "hdfc", type: "income", amountMinor: 79900, last4: "4821", merchant: "NORTHWIND SHOP" },
      auto: true,
    },
    {
      name: "ATM withdrawal",
      text: "Rs.2000 withdrawn from HDFC Bank A/c XX4821 at ATM MG ROAD on 12-11-26. Not you? Call 1800000000",
      want: { parserId: "hdfc", type: "expense", amountMinor: 200000, last4: "4821", atm: true },
    },
    {
      name: "a refund still to come stays in Review",
      text: "Refund initiated: Amt: Rs.1,200.00 on HDFC Bank Credit Card 4821. To receive your Refund,please update your Bank details: TnC.",
      want: { parserId: "generic" },
      auto: false,
    },
    {
      name: "an OTP is ignored",
      text: "512847 is your OTP for a txn of Rs 999.00 on HDFC Bank Card 4821 at BOOKNOOK. Valid 5 mins. Never share OTP with anyone.",
      want: { kind: "ignored", reason: "otp" },
    },
    {
      name: "a bill due notice is ignored",
      text: "New Bill Alert: Your CITY POWER Bill of Rs.1,500.00 is due on 20-Nov-2026. To pay, login to HDFC Bank NetBanking. Ignore if paid",
      want: { kind: "ignored", reason: "reminder" },
    },
  ]);
});
