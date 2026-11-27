// Parsers for the payment apps, wallets and card apps (ticket 175). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";

export const APP_PARSERS: readonly BankParser[] = [];
