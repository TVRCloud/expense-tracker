// Parsers for the public sector banks (ticket 171). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";

export const PUBLIC_SECTOR_BANKS: readonly BankParser[] = [];
