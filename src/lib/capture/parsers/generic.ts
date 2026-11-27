// The fallback for any sender without its own parser. Covers the usual phrasing across HDFC, ICICI, SBI, Axis,
// Kotak and UPI apps:
//   "Rs.500.00 debited from A/c XX1234 on 26-09-26 to VPA swiggy@icici. UPI Ref 426912345678"
//   "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 26/09/26 Ref 426912345678"
//   "INR 1,200.00 credited to your A/c No XX5678 on 26 Sep 2026 by NEFT from ACME PVT LTD"
//   "₹250 paid to Swiggy" (a UPI app notification: no account, lower confidence)

import { BankParser } from "./base";

export class GenericParser extends BankParser {
  readonly id = "generic";
  readonly bankName = undefined;

  /** Never picked by sender: it is what runs when no bank parser claims the message. */
  override canHandle(): boolean {
    return false;
  }
}

export const genericParser = new GenericParser();
