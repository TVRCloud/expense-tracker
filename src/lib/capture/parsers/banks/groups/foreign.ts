// Parsers for the foreign banks in India (ticket 174). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";

export const FOREIGN_BANKS: readonly BankParser[] = [];
