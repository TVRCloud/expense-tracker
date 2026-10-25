import { describe, expect, it } from "vitest";
import { createMoveKey, createMoveKeys } from "./move-key";

const counter = () => {
  let n = 0;
  return () => `k${(n += 1)}`;
};
const move = { to: "Fun", amount: 500, allowOverdraw: false };

describe("move Idempotency-Key", () => {
  it("a retry of the same move keeps its key, however often it is sent", () => {
    const k = createMoveKey(counter());
    const first = k.keyFor(move);
    expect(k.keyFor({ ...move })).toBe(first);
    expect(k.keyFor({ ...move })).toBe(first);
  });

  it("retyping an identical amount does not change the key", () => {
    const k = createMoveKey(counter());
    const first = k.keyFor({ ...move, amount: 500 });
    // the person clears the field and types 5.00 again: the same move
    expect(k.keyFor({ ...move, amount: Number("5.00") * 100 })).toBe(first);
  });

  it("a different destination, amount or overdraw switch is a different move with a new key", () => {
    const k = createMoveKey(counter());
    const a = k.keyFor(move);
    const b = k.keyFor({ ...move, amount: 600 });
    const c = k.keyFor({ ...move, amount: 600, to: "Rent" });
    const d = k.keyFor({ ...move, amount: 600, to: "Rent", allowOverdraw: true });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("editing and changing back still counts as a new send, never a reused key for another move", () => {
    const k = createMoveKey(counter());
    const a = k.keyFor(move);
    const b = k.keyFor({ ...move, amount: 600 });
    const back = k.keyFor(move);
    expect(b).not.toBe(a);
    expect(back).not.toBe(b);
  });

  it("nothing changes the key until a send: editing the form between sends does not rotate it", () => {
    const k = createMoveKey(counter());
    const a = k.keyFor(move);
    // (edits happen in the form only; keyFor is not called)
    expect(k.keyFor(move)).toBe(a);
  });

  it("after a definite refusal the next send gets a new key, even for the same move", () => {
    const k = createMoveKey(counter());
    const a = k.keyFor(move);
    k.refused();
    const b = k.keyFor(move);
    expect(b).not.toBe(a);
    expect(k.keyFor(move)).toBe(b);
  });
});

describe("move keys kept above the dialog", () => {
  it("closing and reopening the dialog after an unsettled move finds the same key", () => {
    const keys = createMoveKeys(counter());
    const first = keys.get("2026-10|Food").keyFor(move);
    // the dialog is closed, then reopened for the same envelope, and the same move is sent
    expect(keys.get("2026-10|Food").keyFor(move)).toBe(first);
  });

  it("other envelopes and months have their own keys, and a finished move starts fresh", () => {
    const keys = createMoveKeys(counter());
    const food = keys.get("2026-10|Food").keyFor(move);
    expect(keys.get("2026-10|Rent").keyFor(move)).not.toBe(food);
    expect(keys.get("2026-11|Food").keyFor(move)).not.toBe(food);
    keys.done("2026-10|Food");
    expect(keys.get("2026-10|Food").keyFor(move)).not.toBe(food);
  });
});
