// Parsers for the small finance and payments banks (ticket 173). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";

export const SMALL_FINANCE_BANKS: readonly BankParser[] = [];
