// Parsers for the other private banks (ticket 172). Each parser lives in its own file in this
// folder's parent (banks/), extends KnownBankParser and is listed here in the order the registry tries them.
import type { BankParser } from "../../base";
import { CityUnionParser } from "../city-union";
import { DhanlaxmiParser } from "../dhanlaxmi";
import { FederalParser } from "../federal";
import { IdbiParser } from "../idbi";
import { IndusIndParser } from "../indusind";
import { JkParser } from "../jk";
import { KarnatakaParser } from "../karnataka";
import { KeralaParser } from "../kerala";
import { KeralaGraminParser } from "../kerala-gramin";
import { SaraswatParser } from "../saraswat";
import { SouthIndianParser } from "../south-indian";
import { TamilnadMercantileParser } from "../tamilnad-mercantile";
import { YesParser } from "../yes";

export const PRIVATE_BANKS: readonly BankParser[] = [
  new FederalParser(),
  new IdbiParser(),
  new YesParser(),
  new IndusIndParser(),
  new SouthIndianParser(),
  new KarnatakaParser(),
  new CityUnionParser(),
  new TamilnadMercantileParser(),
  new DhanlaxmiParser(),
  new JkParser(),
  new KeralaParser(),
  new KeralaGraminParser(),
  new SaraswatParser(),
];
