import { describe, expect, it } from "vitest";
import { createMoveKeys, MAX_UNSETTLED, type MoveSpec } from "./move-key";

const counter = () => {
  let n = 0;
  return () => `k${(n += 1)}`;
};
const A: MoveSpec = { month: "2026-10", from: "Food", to: "Fun", amount: 500, allowOverdraw: false };
const B: MoveSpec = { ...A, amount: 600 };

describe("move Idempotency-Key", () => {
  it("every send of the same move uses the same key until it settles", () => {
    const keys = createMoveKeys(counter());
    const first = keys.keyFor(A);
    expect(keys.keyFor({ ...A })).toBe(first);
    expect(keys.keyFor({ ...A })).toBe(first);
  });

  it("retyping an identical amount is the same move", () => {
    const keys = createMoveKeys(counter());
    const first = keys.keyFor({ ...A, amount: 500 });
    expect(keys.keyFor({ ...A, amount: Number("5.00") * 100 })).toBe(first);
  });

  it("A, then B, then A again: A gets its own key back, so an ambiguous A can never run twice", () => {
    const keys = createMoveKeys(counter());
    const a = keys.keyFor(A);
    const b = keys.keyFor(B);
    expect(b).not.toBe(a);
    expect(keys.keyFor(A)).toBe(a);
    expect(keys.keyFor(B)).toBe(b);
  });

  it("a different month, source, destination or overdraw switch is a different move", () => {
    const keys = createMoveKeys(counter());
    const seen = new Set([
      keys.keyFor(A),
      keys.keyFor({ ...A, month: "2026-11" }),
      keys.keyFor({ ...A, from: "Rent" }),
      keys.keyFor({ ...A, to: "Rent" }),
      keys.keyFor({ ...A, allowOverdraw: true }),
    ]);
    expect(seen.size).toBe(5);
  });

  it("settling a move (success or definite refusal) gives its next send a new key, and leaves others alone", () => {
    const keys = createMoveKeys(counter());
    const a = keys.keyFor(A);
    const b = keys.keyFor(B);
    keys.settle(A);
    expect(keys.keyFor(A)).not.toBe(a);
    expect(keys.keyFor(B)).toBe(b);
  });

  it("start over replaces the key of that move only", () => {
    const keys = createMoveKeys(counter());
    const a = keys.keyFor(A);
    const b = keys.keyFor(B);
    keys.startOver(A);
    expect(keys.keyFor(A)).not.toBe(a);
    expect(keys.keyFor(B)).toBe(b);
  });

  it("is a store above any component: a second reader (the page after navigating back) sees the same keys", () => {
    const keys = createMoveKeys(counter());
    const sent = keys.keyFor(A); // the request was sent, then the person left the page
    // the page unmounted: nothing was settled; coming back reads the same store
    expect(keys.keyFor(A)).toBe(sent);
    expect(keys.size()).toBe(1);
  });

  it("holds a bounded number of unsettled keys, dropping the oldest", () => {
    const keys = createMoveKeys(counter());
    const first = keys.keyFor(A);
    for (let i = 0; i < MAX_UNSETTLED; i += 1) keys.keyFor({ ...A, amount: 1000 + i });
    expect(keys.size()).toBe(MAX_UNSETTLED);
    expect(keys.keyFor(A)).not.toBe(first);
  });
});
