// Airtel Payments Bank. Its alerts name no account digits ("Airtel Payments Bank a/c is credited with Rs. …",
// "Rs. … debited from Airtel Payments Bank a/c Txn ID …"), so a read never earns the account's share of the score and
// goes to Review, where the person picks the account; nothing is guessed. Ticket 173.

import { KnownBankParser } from "./known";

export class AirtelPbParser extends KnownBankParser {
  readonly id = "airtel_pb";
  readonly bankName = "Airtel Payments Bank";
  override readonly senderIds = ["AIRBNK"];

  protected readonly shapes = [
    /^Airtel\sPayments\sBank\sa\/c\sis\scredited\swith\sRs\.?\s?[\d,.]{1,15}\b/i,
    /^Rs\.?\s?[\d,.]{1,15}\sdebited\sfrom\sAirtel\sPayments\sBank\sa\/c\b/i,
  ];
}
