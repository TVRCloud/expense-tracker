// Parsers for the public sector banks (ticket 171). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";
import { BobParser } from "../bob";
import { BoiParser } from "../boi";
import { CanaraParser } from "../canara";
import { CentralParser } from "../central";
import { IndianBankParser } from "../indian";
import { IobParser } from "../iob";
import { PnbParser } from "../pnb";
import { PsbParser } from "../psb";
import { UcoParser } from "../uco";
import { UnionParser } from "../union";

export const PUBLIC_SECTOR_BANKS: readonly BankParser[] = [
  new CanaraParser(),
  new PnbParser(),
  new BobParser(),
  new UnionParser(),
  new BoiParser(),
  new CentralParser(),
  new IndianBankParser(),
  new IobParser(),
  new UcoParser(),
  new PsbParser(),
];
