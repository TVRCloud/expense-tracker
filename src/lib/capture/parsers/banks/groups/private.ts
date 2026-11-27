// Parsers for the other private banks (ticket 172). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";

export const PRIVATE_BANKS: readonly BankParser[] = [];
