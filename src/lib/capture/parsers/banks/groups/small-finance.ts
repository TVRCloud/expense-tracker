// Parsers for the small finance and payments banks (ticket 173). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";
import { AirtelPbParser } from "../airtel-pb";
import { AuParser } from "../au";
import { BandhanParser } from "../bandhan";
import { EquitasParser } from "../equitas";
import { IppbParser } from "../ippb";
import { JanaParser } from "../jana";
import { JioPbParser } from "../jio-pb";
import { NsdlPbParser } from "../nsdl-pb";
import { SuryodayParser } from "../suryoday";
import { UtkarshParser } from "../utkarsh";

export const SMALL_FINANCE_BANKS: readonly BankParser[] = [
  new AuParser(),
  new BandhanParser(),
  new EquitasParser(),
  new UtkarshParser(),
  new JanaParser(),
  new SuryodayParser(),
  new AirtelPbParser(),
  new IppbParser(),
  new JioPbParser(),
  new NsdlPbParser(),
];
