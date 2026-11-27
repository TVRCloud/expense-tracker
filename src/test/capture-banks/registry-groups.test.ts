import { describe, expect, it } from "vitest";
import { BANK_PARSERS } from "@/lib/capture/parsers";
import { normaliseSender } from "@/lib/capture/parsers/sender";

// Ticket 170: every parser in every group is registered once, and no two parsers claim the same SMS header or
// app package (the first would silently win).
describe("bank parser groups", () => {
  it("lists every parser once", () => {
    const ids = BANK_PARSERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets two parsers claim the same header or package", () => {
    const owner = new Map<string, string>();
    for (const p of BANK_PARSERS) {
      for (const key of [...p.senderIds.map((s) => `sms:${normaliseSender(s)}`), ...p.packageNames.map((n) => `app:${n.toLowerCase()}`)]) {
        expect(owner.get(key), `${key} claimed by ${owner.get(key)} and ${p.id}`).toBeUndefined();
        owner.set(key, p.id);
      }
    }
  });
});
