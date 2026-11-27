// Every bank parser, in the order the registry tries them.
import { AxisParser } from "./axis";
import { HdfcParser } from "./hdfc";
import { IciciParser } from "./icici";
import { IdfcParser } from "./idfc";
import { KotakParser } from "./kotak";
import { SbiParser } from "./sbi";

export const BANKS = [new HdfcParser(), new IciciParser(), new SbiParser(), new AxisParser(), new KotakParser(), new IdfcParser()];
