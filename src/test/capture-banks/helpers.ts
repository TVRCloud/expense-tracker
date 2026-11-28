import { expect, it } from "vitest";
import { CONFIDENCE_AUTO_CREATE, parseCapture, type CaptureParse, type MessageSource } from "@/lib/capture/parsers";

// Ticket 155: every message in these tables is invented in the shape the bank sends (fake amounts, digits, refs and
// names). None is copied from another project.
export const RECEIVED = new Date("2026-11-12T06:30:00Z"); // 12:00 IST, 12 Nov 2026

export interface Fixture {
  name: string;
  text: string;
  source?: MessageSource;
  /** Fields the parse must have (kind, type, amountMinor, last4, merchant, parserId, ...). */
  want: Record<string, unknown>;
  /** true: booked without Review; false: must go to Review. Left out: not checked. */
  auto?: boolean;
}

export function readsAll(defaultSource: MessageSource, fixtures: Fixture[]) {
  for (const f of fixtures) {
    it(f.name, () => {
      const p: CaptureParse = parseCapture(f.text, RECEIVED, f.source ?? defaultSource);
      expect(p).toMatchObject(f.want);
      for (const [key, value] of Object.entries(f.want)) {
        if (value === undefined) expect((p as unknown as Record<string, unknown>)[key]).toBeUndefined();
      }
      if (f.auto === true) expect(p.confidence).toBeGreaterThanOrEqual(CONFIDENCE_AUTO_CREATE);
      if (f.auto === false) expect(p.confidence).toBeLessThan(CONFIDENCE_AUTO_CREATE);
    });
  }
}
