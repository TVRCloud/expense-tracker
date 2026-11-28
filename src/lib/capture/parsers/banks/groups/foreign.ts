// Parsers for the foreign banks in India (ticket 174). Each parser lives in its own file in this folder's parent
// (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";
import { AmexParser } from "../amex";
import { DbsParser } from "../dbs";
import { HsbcParser } from "../hsbc";
import { StandardCharteredParser } from "../standard-chartered";

export const FOREIGN_BANKS: readonly BankParser[] = [new HsbcParser(), new StandardCharteredParser(), new DbsParser(), new AmexParser()];
