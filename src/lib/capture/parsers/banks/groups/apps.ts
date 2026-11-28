// Parsers for the payment apps, wallets and card apps (ticket 175). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser (through AppParser) and is listed here in the order the registry
// tries them.
import type { BankParser } from "../../base";
import { CredParser } from "../cred";
import { JupiterParser } from "../jupiter";
import { JuspayParser } from "../juspay";
import { LazyPayParser } from "../lazypay";
import { OneCardParser } from "../onecard";
import { PhonePeWalletParser } from "../phonepe-wallet";
import { SliceParser } from "../slice";

export const APP_PARSERS: readonly BankParser[] = [
  new PhonePeWalletParser(),
  new JupiterParser(),
  new SliceParser(),
  new OneCardParser(),
  new CredParser(),
  new LazyPayParser(),
  new JuspayParser(),
];
