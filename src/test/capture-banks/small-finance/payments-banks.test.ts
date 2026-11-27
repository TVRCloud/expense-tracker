import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 173: invented messages in the shape the payments banks send.
describe("NSDL Payments Bank parser", () => {
  readsAll({ sender: "AD-NSDLPB-S" }, [
    {
      name: "UPI debit names the payee after linked",
      text: "A/c XX6672 debited Rs 347.00 on 14-Nov-26 for linked pinecone.cafe@oksbi. UPI Ref 638266770011 - NSDLPB",
      want: { parserId: "nsdl_pb", type: "expense", amountMinor: 34700, last4: "6672", merchant: "pinecone.cafe@oksbi", ref: "638266770011" },
      auto: true,
    },
    {
      name: "through a linked wallet: the payee after to, never the wallet account",
      text: "A/c XX6672 debited Rs 1,275.00 on 14-Nov-26 for linked Maple Bank PPI A/c XX5310 to grocer.hub@axl. UPI Ref 638266770013 - NSDLPB",
      want: { parserId: "nsdl_pb", type: "expense", amountMinor: 127500, last4: "6672", merchant: "grocer.hub@axl" },
      auto: true,
    },
    {
      name: "credit",
      text: "A/c no XX6672 is credited for Rs.263.00 on 14-Nov-26 (UPI Ref No 638266770012) - NSDLPB",
      want: { parserId: "nsdl_pb", type: "income", amountMinor: 26300, last4: "6672", ref: "638266770012" },
      auto: true,
    },
    {
      name: "a UPI id with a balance label glued to it",
      text: "A/c XX6672 debited Rs 146.00 on 15-Nov-26 for linked chaat.point@ybl.Avl Bal Rs 2,014.30",
      want: { parserId: "nsdl_pb", type: "expense", amountMinor: 14600, merchant: "chaat.point@ybl" },
    },
    {
      name: "a payment request is not money",
      text: "chaat.point@ybl has requested Rs 146.00 from your NSDL Payments Bank A/c XX6672. Ignore if not you - NSDLPB",
      want: { kind: "ignored" },
    },
  ]);
});

describe("Jio Payments Bank parser", () => {
  readsAll({ sender: "JD-JIOPBS-S" }, [
    {
      name: "debit with the payee in the UPI path",
      text: "Your JPB A/c x5530 is debited with Rs. 627.00 on 14-Nov-26. UPI/DR/638277880011/SHARMA GENERAL. Avl. Bal: Rs. 2,184.60",
      want: { parserId: "jio_pb", type: "expense", amountMinor: 62700, last4: "5530", merchant: "SHARMA GENERAL", ref: "638277880011", balanceMinor: 218460 },
      auto: true,
    },
    {
      name: "credit",
      text: "Your JPB A/c x5530 is credited with Rs.1,186.00 on 14-Nov-26. UPI/CR/638277880012/PRIYA DAS. Avl. Bal: Rs. 3,384.60",
      want: { parserId: "jio_pb", type: "income", amountMinor: 118600, last4: "5530", merchant: "PRIYA DAS" },
      auto: true,
    },
    {
      name: "send from an account masked with one x",
      text: "Rs. 230.00 Sent from x5530 to dosa.point@ybl on 14-Nov-26. UPI Ref 638277880013. Avl. Bal: Rs. 1,954.60",
      want: { parserId: "jio_pb", type: "expense", amountMinor: 23000, last4: "5530", merchant: "dosa.point@ybl" },
      auto: true,
    },
    {
      name: "a payee written as a phone number is no merchant",
      text: "Rs. 515.00 Sent from x8820 to 9876500021 on 15-Nov-26. UPI Ref 639011220033",
      want: { parserId: "jio_pb", type: "expense", amountMinor: 51500, last4: "8820", merchant: undefined },
    },
    {
      name: "a payee written as a single-x mask is no merchant",
      text: "Rs. 515.00 Sent from x8820 to A/c x4471 on 15-Nov-26. UPI Ref 639011220035",
      want: { parserId: "jio_pb", type: "expense", amountMinor: 51500, last4: "8820", merchant: undefined },
    },
    {
      name: "a UPI path naming a masked account gives no merchant",
      text: "Your JPB A/c x8820 is debited with Rs. 318.00 on 15-Nov-26. UPI/DR/639033440041/X4471. Avl. Bal: Rs. 1,201.00",
      want: { parserId: "jio_pb", type: "expense", amountMinor: 31800, last4: "8820", merchant: undefined },
    },
  ]);
});

describe("Airtel Payments Bank parser", () => {
  // No account digits are printed, so these always wait in Review for the person to pick the account.
  readsAll({ sender: "AD-AIRBNK-S" }, [
    {
      name: "credit with no account digits goes to Review",
      text: "Airtel Payments Bank a/c is credited with Rs.76.45. Txn ID: 638299001122. Call 1800xxxx for help",
      want: { parserId: "airtel_pb", type: "income", amountMinor: 7645, last4: undefined, ref: "638299001122" },
      auto: false,
    },
    {
      name: "debit with no account digits goes to Review",
      text: "Rs. 48.00 debited from Airtel Payments Bank a/c Txn ID 638299001123 Bal:212.40 Call 1800xxxx for help",
      want: { parserId: "airtel_pb", type: "expense", amountMinor: 4800, last4: undefined },
      auto: false,
    },
    {
      name: "another party's account digits never become the account",
      text: "Money sent! Rs.265.00 to RAVI KUMAR A/c XX9911 from your Airtel Payments Bank a/c. Txn ID 639011220040",
      want: { parserId: "airtel_pb", type: "expense", amountMinor: 26500, last4: undefined },
      auto: false,
    },
    {
      name: "money from another account keeps no digits",
      text: "Rs.265.00 received from a/c XX9911 in your Airtel Payments Bank a/c. Txn ID 639011220041",
      want: { parserId: "airtel_pb", type: "income", amountMinor: 26500, last4: undefined },
      auto: false,
    },
    {
      name: "an OTP stays ignored",
      text: "639014 is your OTP to send Rs.265.00 from your Airtel Payments Bank a/c. Do not share.",
      want: { kind: "ignored", reason: "otp" },
    },
    {
      name: "a payee's account sent through the bank never becomes the account",
      text: "Rs.265.00 sent to RAVI A/c XX9911 via Airtel Payments Bank. Txn ID 639055660042",
      want: { parserId: "airtel_pb", type: "expense", amountMinor: 26500, last4: undefined },
      auto: false,
    },
    {
      name: "a year after a/c is never the account",
      text: "Rs.265.00 received in Airtel Payments Bank a/c 2026 from RAVI on 15-11-26",
      want: { parserId: "airtel_pb", type: "income", last4: undefined },
      auto: false,
    },
  ]);
});

describe("India Post Payments Bank parser", () => {
  readsAll({ sender: "VM-IPBMSG-S" }, [
    {
      name: "debit written Debit Rs",
      text: "A/C X7741 Debit Rs.183.00 for UPI to chai.corner@ybl on 14-11-26 Ref 638288990011. Avl Bal Rs.1,436.20",
      want: { parserId: "ippb", type: "expense", amountMinor: 18300, last4: "7741", merchant: "chai.corner@ybl", ref: "638288990011", balanceMinor: 143620 },
      auto: true,
    },
    {
      name: "payment received names the payer before thru IPPB",
      text: "You have received a payment of Rs.937.00 in a/c X7741 on 14-11-26 from MOHAN LAL thru IPPB. Info: UPI/CREDIT/638288990012. Avl Bal Rs.2,386.20",
      want: { parserId: "ippb", type: "income", amountMinor: 93700, last4: "7741", merchant: "MOHAN LAL", ref: "638288990012" },
      auto: true,
    },
    {
      name: "credit written Credit Rs",
      text: "A/C X7741 Credit Rs.418.00 for UPI from tea.stall@ybl on 15-11-26 Ref 639011220036. Avl Bal Rs.1,213.40",
      want: { parserId: "ippb", type: "income", amountMinor: 41800, last4: "7741", merchant: "tea.stall@ybl" },
      auto: true,
    },
    {
      name: "a reversed debit is never auto-booked either way",
      text: "A/C X7741 Debit Rs.645.00 for UPI to sunita.k@ybl on 15-11-26 is reversed",
      want: { parserId: "ippb", amountMinor: 64500 },
      auto: false,
    },
    {
      name: "a UPI id with a balance label glued to it",
      text: "A/C X7741 Debit Rs.146.00 for UPI to dosa.hut@ybl.Avl Bal Rs.1,067.40",
      want: { parserId: "ippb", type: "expense", merchant: "dosa.hut@ybl" },
    },
    {
      name: "a help line about refunds does not change a debit",
      text: "A/C X7741 Debit Rs.186.00 for UPI to chai.stop@ybl on 15-11-26 Ref 639022330041. Avl Bal Rs.1,027.40. For refund queries call 1552xx",
      want: { parserId: "ippb", type: "expense", amountMinor: 18600, merchant: "chai.stop@ybl" },
      auto: true,
    },
    {
      name: "a credit for a reversal is money back, checked in Review",
      text: "A/C X7741 Credit Rs.186.00 for UPI reversal on 15-11-26 Ref 639022330042. Avl Bal Rs.1,213.40",
      want: { parserId: "ippb", type: "income", amountMinor: 18600, last4: "7741" },
      auto: false,
    },
  ]);
});

describe("Utkarsh Small Finance Bank SuperCard parser", () => {
  readsAll({ sender: "VM-UTKSPR-S" }, [
    {
      name: "spend through UPI",
      text: "Rs.245.00 spent on your Utkarsh SuperCard XX4410 for UPI - ganesh.dairy@ybl on 14-11-26. Avl limit Rs.38,755.00",
      want: { parserId: "utkarsh", type: "expense", amountMinor: 24500, last4: "4410", instrument: "card", merchant: "ganesh.dairy@ybl", availableLimitMinor: 3875500 },
      auto: true,
    },
    {
      name: "spend at a shop",
      text: "Rs.1,320.00 spent on your Utkarsh SuperCard XX4410 for PETROMART on 14-11-26. Avl limit Rs.37,435.00",
      source: { sender: "AD-UTKSFB-S" },
      want: { parserId: "utkarsh", type: "expense", amountMinor: 132000, last4: "4410", merchant: "PETROMART" },
      auto: true,
    },
    {
      name: "repayment from a bank account is a card payment on the card",
      text: "Rs.5,035.00 debited from A/c XX1177 for Utkarsh SuperCard XX4410 repayment",
      want: { parserId: "utkarsh", cardPayment: true, last4: "4410", instrument: "card", amountMinor: 503500 },
      auto: false,
    },
    {
      name: "money paid to the card is a card payment",
      text: "Rs.5,035.00 paid to your Utkarsh SuperCard XX4410 from A/c XX1177",
      want: { parserId: "utkarsh", cardPayment: true, last4: "4410" },
      auto: false,
    },
    {
      name: "a bill payment towards the card is a card payment",
      text: "Rs.5,035.00 debited from A/c XX1177 towards Utkarsh SuperCard XX4410 bill payment",
      want: { parserId: "utkarsh", cardPayment: true, last4: "4410" },
      auto: false,
    },
    {
      name: "a UPI id with supercard in it is a payee, not the card",
      text: "Rs.391.00 debited from your Utkarsh A/c XX1177 for UPI payment to supercard.store@ybl. Avl Bal Rs.1,003.00",
      source: { sender: "AD-UTKSFB-S" },
      want: { parserId: "utkarsh", type: "expense", amountMinor: 39100, last4: "1177", merchant: "supercard.store@ybl" },
      auto: true,
    },
    {
      name: "an EMI taken on the card keeps the card",
      text: "EMI of Rs.505.00 debited on your Utkarsh SuperCard XX4410 on 15-11-26",
      want: { parserId: "utkarsh", type: "expense", amountMinor: 50500, last4: "4410", instrument: "card" },
      auto: true,
    },
  ]);
});
