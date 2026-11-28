// Indian Overseas Bank. Its alerts read like the common Indian wording the generic rules already cover, so this parser
// only names the bank for messages from its header and earns no bonus (no shape of its own is known well enough).

import { PublicSectorParser } from "./public-sector-base";

export class IobParser extends PublicSectorParser {
  readonly id = "iob";
  readonly bankName = "Indian Overseas Bank";
  override readonly senderIds = ["IOBCHN"];

  protected readonly shapes: readonly RegExp[] = [];
}
