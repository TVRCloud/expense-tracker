// DBS Bank India (digibank). Account alerts read "Your account no ********5832 is debited with INR ...", which the shared
// rules already read; this parser adds the bank's name and the bonus for that shape. Its "Current Balance is INR ..."
// is left unread: the shared balance rule skips "current" balances because on a card they mean the amount owed.

import { KnownBankParser } from "./known";

export class DbsParser extends KnownBankParser {
  readonly id = "dbs";
  readonly bankName = "DBS Bank";
  override readonly senderIds = ["DBSBNK"];

  protected readonly shapes = [/^Your\saccount\sno\s\*{4,12}\d{4}\sis\s(?:debited|credited)\swith\sINR\s?[\d,.]{1,15}\s/i];
}
