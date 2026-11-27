// Punjab & Sind Bank. "A/C No **7326 Credited with Rs 1297--<rail>/<ref>/NAME (CLR BAL …CR)(date) Punjab&Sind Bank":
// the other party sits after the reference in the rail path ("--NEFT/<ref>/NAME (", "--UPI/CR/<ref>/NAME/<bank>/…").

import type { FoundAccount } from "../extract/account";
import { cleanParty, sharedParty, verbAccount } from "./known";
import { nameOnly, PublicSectorParser } from "./public-sector-base";

/** A name never keeps a phone or account number ("RAVI 9812345678" is "RAVI"); a reversal code ("REV") is no name. */
function withoutPhone(raw: string | undefined): string | undefined {
  const name = nameOnly(raw);
  return name && !/^(?:REV|REVERSAL|RET|RETURN)$/i.test(name) ? name : undefined;
}

export class PsbParser extends PublicSectorParser {
  readonly id = "psb";
  readonly bankName = "Punjab & Sind Bank";
  override readonly senderIds = ["PSBANK"];

  protected readonly shapes = [/\bA\/c\sNo\s\*{2}\d{4}\s(?:Credited|Debited)\swith\sRs\s[\d,.]{1,15}--/i];

  protected override account(text: string, type: "income" | "expense"): FoundAccount | null {
    // Two accounts in one message: the one next to the verb that matches the direction (ticket 156).
    const moved = verbAccount(text, type);
    if (moved) return moved;
    // A loan account ("Loan A/c No **9910") is never the person's own account.
    const acct = text.match(/(?<!\bloan\s)\bA\/c\sNo\s\*{2}(\d{4})\b/i);
    return acct ? { last4: acct[1], instrument: "account" } : super.account(text, type);
  }

  protected override merchant(text: string, type: "income" | "expense"): string | undefined {
    const rail = text.match(/--(?:NEFT|RTGS|IMPS)\/[A-Za-z0-9]{4,30}\/([^/(]{1,60}?)\s?[/(]/i);
    const upi = text.match(/--UPI\/(?:CR|DR)\/\d{6,22}\/([^/]{1,60}?)\//i);
    if (rail || upi) return withoutPhone(rail?.[1] ?? upi?.[1]);
    // "--Vendor Amount (", "--EMI (": a note, never a name.
    return /--[^(]{0,60}\(/.test(text) ? undefined : sharedParty(super.merchant(text, type));
  }

  protected override ref(text: string): string | undefined {
    return text.match(/--(?:UPI\/(?:CR|DR)|NEFT|RTGS|IMPS)\/([A-Za-z0-9]{6,22})\//i)?.[1] ?? super.ref(text);
  }
}
