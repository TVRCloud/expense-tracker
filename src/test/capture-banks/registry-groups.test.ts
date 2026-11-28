import { describe, expect, it } from "vitest";
import { BANK_PARSERS, BankParser } from "@/lib/capture/parsers";
import { normaliseSender } from "@/lib/capture/parsers/sender";

// Ticket 170: every parser in every group is registered once, and no two parsers claim the same SMS header or
// app package (the first would silently win). Keys are normalised the same way `BankParser.canHandle` compares them.
function claims(parsers: readonly BankParser[]): string[] {
  const owner = new Map<string, string>();
  const clashes: string[] = [];
  for (const p of parsers) {
    const keys = [
      ...p.senderIds.map((s) => `sms:${normaliseSender(s) ?? `(empty ${s})`}`),
      ...p.packageNames.map((n) => `app:${n.trim().toLowerCase()}`),
    ];
    for (const key of keys) {
      const first = owner.get(key);
      if (first) clashes.push(`${key} claimed by ${first} and ${p.id}`);
      else owner.set(key, p.id);
    }
  }
  return clashes;
}

class Fake extends BankParser {
  readonly bankName = "Fake";
  constructor(
    readonly id: string,
    override readonly senderIds: readonly string[],
    override readonly packageNames: readonly string[] = []
  ) {
    super();
  }
}

describe("bank parser groups", () => {
  it("lists every parser once", () => {
    const ids = BANK_PARSERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets two parsers claim the same header or package", () => {
    expect(claims(BANK_PARSERS)).toEqual([]);
  });

  it("catches a clash written with a prefix, a suffix, other case or spaces", () => {
    expect(claims([new Fake("a", ["VM-ABCDEF"]), new Fake("b", ["abcdef-S"])])).toHaveLength(1);
    expect(claims([new Fake("a", [], ["com.bank.app"]), new Fake("b", [], [" Com.Bank.App "])])).toHaveLength(1);
    expect(claims([new Fake("a", ["ABCDEF"]), new Fake("b", ["ABCDEG"])])).toEqual([]);
  });
});
