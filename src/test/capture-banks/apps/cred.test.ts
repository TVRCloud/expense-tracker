import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 175: invented messages in the shapes CRED sends.
describe("CRED parser", () => {
  readsAll({ sender: "JK-CREDIN-S" }, [
    {
      name: "a card bill paid through CRED is a card payment of the card's bank",
      text: "Payment of Rs.8,465 has been successfully credited towards your ICICI Bank Credit Card. -CRED",
      want: { parserId: "cred", cardPayment: true, amountMinor: 846500, bankName: "ICICI Bank" },
      auto: false,
    },
    {
      name: "a spend made with a card is never read as a card bill payment",
      text: "Thank you for your payment of Rs 615 to Lumen Broadband using credit card XX5184 on 04-11-26",
      want: { parserId: "generic", type: "expense", amountMinor: 61500, last4: "5184" },
    },
    {
      name: "a UPI payment through CRED is left to the generic parser",
      text: "Paid Rs 2,035 to RAHUL K via CRED UPI from your bank account.",
      want: { parserId: "generic", type: "expense", amountMinor: 203500 },
      auto: false,
    },
  ]);
});
