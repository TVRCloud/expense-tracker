import { describe } from "vitest";
import { readsAll } from "../helpers";

// Ticket 172: invented messages in the shapes Karnataka Bank, City Union Bank, Tamilnad Mercantile Bank, Dhanlaxmi
// Bank, J&K Bank, Kerala Bank, Kerala Gramin Bank and Saraswat Bank send (fake amounts, digits, refs and names).
describe("Karnataka Bank parser", () => {
  readsAll({ sender: "VM-KBLBNK-S" }, [
    {
      name: "UPI debit names the payee after 'trf to'",
      text: "Your a/c XX6152 debited for Rs.145.00 on 04-10-26 trf to SUNRISE TEA STALL. UPI:6*********77.For dispute SMS BLOCK 6152 to 0000000000 -KarnatakaBank",
      want: { parserId: "karnataka", type: "expense", amountMinor: 14500, last4: "6152", merchant: "SUNRISE TEA STALL" },
      auto: true,
    },
  ]);
});

describe("City Union Bank parser", () => {
  readsAll({ sender: "VM-CUBANK-S" }, [
    {
      name: "a debit naming the payee's account keeps the payer's",
      text: "Your a/c no. XXXXXXXXXXX6152 is debited for Rs.312.00 on 04-10-2026 and credited to a/c no. XXXXXXXXXXX8841 (UPI Ref no 604377021122)",
      want: { parserId: "city_union", type: "expense", amountMinor: 31200, last4: "6152", ref: "604377021122" },
      auto: true,
    },
    {
      name: "a credit naming the payer's account keeps the person's",
      text: "Your a/c no. XXXXXXXXXXX6152 is credited for Rs.2,450.00 on 04-10-2026 and debited from a/c no. XXXXXXXXXXX8841 (UPI Ref no 604377023344)",
      want: { parserId: "city_union", type: "income", amountMinor: 245000, last4: "6152", ref: "604377023344" },
      auto: true,
    },
    {
      name: "an AutoPay notice is not money",
      text: "Your account will be debited with Rs.83.00 on 12-10-2026 towards PIXELPLAY MEDIA PRIVATE LIMITED UPI Autopay. -CUB",
      want: { kind: "ignored" },
    },
  ]);
});

describe("Tamilnad Mercantile Bank parser", () => {
  readsAll({ sender: "VM-TMBANK-S" }, [
    {
      name: "UPI debit names the payee's UPI id after 'linked to'",
      text: "Your A/c No.XXXX6152 is debited with Rs.264.50 on 04-10-2026 07:12 PM and UTIB A/c linked to lakeside.kitchen@axl is credited (UPI Ref No.604377025566).Current AVBL bal is Rs.3,410.25 - TMB",
      want: { parserId: "tmb", type: "expense", amountMinor: 26450, last4: "6152", merchant: "lakeside.kitchen@axl", ref: "604377025566" },
      auto: true,
    },
  ]);
});

describe("Dhanlaxmi Bank parser", () => {
  readsAll({ sender: "VM-DHANBK-S" }, [
    {
      name: "UPI debit names the payee's UPI id inside the TXN field",
      text: 'INR 85.00 is debited from A/c XXXX6152 on 04-OCT-2026 - "UPI TXN: /604377027788-MR /Payment from PhonePe/q99887766@ybl/YESB0YBLUPI/41721202610040001". Aval Bal is INR 4,215.30. If not transacted call 0000000000.-DhanlaxmiBank',
      want: { parserId: "dhanlaxmi", type: "expense", amountMinor: 8500, last4: "6152", merchant: "q99887766@ybl", ref: "604377027788" },
      auto: true,
    },
    {
      name: "UPI credit names the payer after 'Payment from'",
      text: 'INR 1,560.00 is credited to A/c XXXX6152 on 04-OCT-2026 - "UPI TXN: /604377029900-Rent/Payment from Kavya". Aval Bal is INR 5,715.30 -DhanlaxmiBank',
      want: { parserId: "dhanlaxmi", type: "income", amountMinor: 156000, last4: "6152", merchant: "Kavya", ref: "604377029900" },
      auto: true,
    },
    {
      name: "a credit naming the payer's account keeps the person's",
      text: "Your a/c no. XXXXXXXX6152 is credited for Rs.35.00 on 04-10-26 and debited from a/c no. XXXXXXXX3317 (UPI Ref no 604377031122).-DhanlaxmiBank",
      want: { parserId: "dhanlaxmi", type: "income", amountMinor: 3500, last4: "6152", ref: "604377031122" },
      auto: true,
    },
  ]);
});

describe("J&K Bank parser", () => {
  readsAll({ sender: "VM-JKBANK-S" }, [
    {
      name: "RTGS debit keeps its reference",
      text: "Your A/c XXXXXXXX6152 is Debited by INR 4,615.00 at 11:42 by RTGS-JAKA2026100400017. A/C Bal is INR 18,240.00 Cr. -J&K Bank",
      want: { parserId: "jk", type: "expense", amountMinor: 461500, last4: "6152", ref: "JAKA2026100400017", balanceMinor: 1824000 },
      auto: true,
    },
    {
      name: "UPI credit",
      text: "Your A/c XXXXXXXX6152 is Credited with INR 2,200.00 on 04-10-2026 by UPI Ref 604377033344. Available Bal is INR 20,440.00 Cr. -J&K Bank",
      want: { parserId: "jk", type: "income", amountMinor: 220000, last4: "6152", ref: "604377033344" },
      auto: true,
    },
  ]);
});

describe("Kerala Bank parser", () => {
  readsAll({ sender: "VM-KELBNK-S" }, [
    {
      name: "NEFT credit with no currency names the payer after 'From :'",
      text: "Dear Customer Your A/c no XXXX6152 is credited with 3260.00 on 04-10-2026 by NEFT From : SUNIL MATHEW. Balance is 9450.00 - Kerala Bank",
      want: { parserId: "kerala", type: "income", amountMinor: 326000, last4: "6152", merchant: "SUNIL MATHEW" },
      auto: true,
    },
    {
      name: "UPI debit names the payee after 'To :'",
      text: "Dear Customer Your A/c no XXXX6152 is debited with 655.00 on 04-10-2026 by UPI To : GREENMART. Balance is 8810.00 - Kerala Bank",
      want: { parserId: "kerala", type: "expense", amountMinor: 65500, last4: "6152", merchant: "GREENMART" },
      auto: true,
    },
    {
      name: "a loan recovery credited to a loan account stays in Review",
      text: "Dear Customer Your A/c no XXXX7731 is credited with 9400.00 on 04-10-2026 by Loan Recovery From : 248816072. Balance is -312640.00 - Kerala Bank",
      want: { parserId: "kerala", amountMinor: 940000 },
      auto: false,
    },
  ]);
});

describe("Kerala Gramin Bank parser", () => {
  readsAll({ sender: "VM-KGBANK-S" }, [
    {
      name: "a debit naming the payee's account keeps the payer's",
      text: "Your a/c no. XXXX6152 is debited for Rs.390.00 on 04/10/26 06:12 PM and credited to a/c no. XXXXX88410 (UPI Ref no 604377035566)-Kerala Gramin Bank",
      want: { parserId: "kerala_gramin", type: "expense", amountMinor: 39000, last4: "6152", ref: "604377035566" },
      auto: true,
    },
    {
      name: "UPI credit from a UPI id",
      text: "Dear Customer, Account XXXX6152 is credited with INR 1200 on 04-10-2026 09:41:12 from deepa.s@okaxis. UPI Ref. no. 604377037788-Kerala Gramin Bank",
      want: { parserId: "kerala_gramin", type: "income", amountMinor: 120000, last4: "6152", merchant: "deepa.s@okaxis" },
      auto: true,
    },
  ]);
});

describe("Saraswat Bank parser", () => {
  readsAll({ sender: "VM-SARBNK-S" }, [
    {
      name: "ACH credit names the payer",
      text: "Your A/c no. 6152 is credited with INR 905.00 on 04-10-2026 towards ACH Credit:BRIGHTPOWER LTD. Current Bal is INR 6,325.00 CR - Saraswat Bank",
      want: { parserId: "saraswat", type: "income", amountMinor: 90500, last4: "6152", merchant: "BRIGHTPOWER LTD" },
      auto: true,
    },
    {
      name: "IMPS debit",
      text: "Dear Customer, Your account no. ending with 6152 is debited with INR 2,140.00 on 04-10-2026 for IMPS. Current Bal is INR 4,325.00CR. - Saraswat Bank",
      want: { parserId: "saraswat", type: "expense", amountMinor: 214000, last4: "6152" },
      auto: true,
    },
  ]);
});
