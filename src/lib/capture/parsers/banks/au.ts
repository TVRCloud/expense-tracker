// AU Small Finance Bank. A UPI alert puts the payee in a path on its own line ("UPI/DR/<ref>/<payee>/<bank>/..."),
// after "Debited INR … from A/c X1234", "Dr INR … - AU A/c X1234" or "Cr INR … to A/c X1234"; a credit card spend
// reads "INR … spent at <shop> on AU Bank Credit Card x1234". Ticket 173.

import { sharedParty } from "./known";
import { maskOrNumber, SmallFinanceParser, upiPath } from "./small-finance-helpers";

export class AuParser extends SmallFinanceParser {
  readonly id = "au";
  readonly bankName = "AU Small Finance Bank";
  override readonly senderIds = ["AUBANK"];

  protected readonly shapes = [
    /^(?:Debited|Dr)\sINR\s[\d,.]{1,15}\s(?:from|-\sAU)\sA\/c\sX\d{4}\b/i,
    /^Cr\sINR\s[\d,.]{1,15}\sto\sA\/c\sX\d{4}\b/i,
    /^INR\s[\d,.]{1,15}\sspent\sat\s[^.]{1,60}?\son\sAU\sBank\sCredit\sCard\sx\d{4}\b/i,
  ];

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const path = upiPath(text);
    // A UPI path names the party; when it names none (a bank account), there is no merchant rather than a guess
    // from the help line ("SMS BLOCK UPI to 56…").
    if (path) return path.party && !maskOrNumber(path.party) ? path.party : undefined;
    return sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return upiPath(text)?.ref ?? super.ref(text);
  }
}
