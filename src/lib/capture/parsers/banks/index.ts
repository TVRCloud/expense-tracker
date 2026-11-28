// Every bank parser, in the order the registry tries them: the six from ticket 155 first, then one list per group
// (banks/groups/*.ts), so each group can be added without editing the same lines.
import { AxisParser } from "./axis";
import { APP_PARSERS } from "./groups/apps";
import { FOREIGN_BANKS } from "./groups/foreign";
import { PRIVATE_BANKS } from "./groups/private";
import { PUBLIC_SECTOR_BANKS } from "./groups/public-sector";
import { SMALL_FINANCE_BANKS } from "./groups/small-finance";
import { HdfcParser } from "./hdfc";
import { IciciParser } from "./icici";
import { IdfcParser } from "./idfc";
import { KotakParser } from "./kotak";
import { SbiParser } from "./sbi";

export const BANKS = [
  new HdfcParser(),
  new IciciParser(),
  new SbiParser(),
  new AxisParser(),
  new KotakParser(),
  new IdfcParser(),
  ...PUBLIC_SECTOR_BANKS,
  ...PRIVATE_BANKS,
  ...SMALL_FINANCE_BANKS,
  ...FOREIGN_BANKS,
  ...APP_PARSERS,
];
