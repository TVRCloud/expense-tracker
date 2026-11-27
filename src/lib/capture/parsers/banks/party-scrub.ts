// A payee name as some banks write it, with numbers that are never part of a name: references, masked accounts and
// card numbers ("631088123456/FRESHMART", "HDFC CC 6612", "FD closure 410***551203", "X7781"). Ticket 172 review.

/** True when the text holds a partly shown or masked number ("410***551203", "15XXXXX7731"). */
export function hasMaskedNumber(text: string | undefined): boolean {
  return !!text && /\d[x*]{2,}\d|(?:^|\s)[x*]{2,}\d/i.test(text);
}

/** The name with references, masks and card numbers removed; undefined when nothing that reads like a name is left. */
export function scrubParty(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = name
    .slice(0, 80)
    // A reference glued in front: "631088123456/freshmart@okaxis" keeps what follows the slash.
    .replace(/^\d{6,22}\s?\/\s?/, "")
    // A partly shown or masked number anywhere: "410***551203", "XX4421", "X7781" (never inside a UPI id).
    .replace(/(?<![\w.@-])\d{0,6}[x*]{1,12}\d{2,12}(?![\w@.-])/gi, " ")
    // A card number after "CC" or "card": "HDFC CC 6612".
    .replace(/\b(CC|card)\s\d{4}\b/gi, "$1")
    // A reference of six or more digits, never the digits of a UPI id ("9847012345@ybl").
    .replace(/(?<![\w.@-])\d{6,22}(?![\w@.-])/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s\-/.]+$/, "")
    .trim();
  return v.length >= 2 && /[A-Za-z]{2}/.test(v) ? v : undefined;
}
