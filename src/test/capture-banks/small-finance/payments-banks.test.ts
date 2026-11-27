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
  ]);
});

describe("Airtel Payments Bank parser", () => {
  // No account digits are printed, so these always wait in Review for the person to pick the account.
  readsAll({ sender: "AD-AIRBNK-S" }, [
    {
      name: "credit with no account digits goes to Review",
      text: "Airtel Payments Bank a/c is credited with Rs.76.00. Txn ID: 638299001122. Call 1800xxxx for help",
      want: { parserId: "airtel_pb", type: "income", amountMinor: 7600, last4: undefined, ref: "638299001122" },
      auto: false,
    },
    {
      name: "debit with no account digits goes to Review",
      text: "Rs. 48.00 debited from Airtel Payments Bank a/c Txn ID 638299001123 Bal:212.40 Call 1800xxxx for help",
      want: { parserId: "airtel_pb", type: "expense", amountMinor: 4800, last4: undefined },
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
  ]);
});
