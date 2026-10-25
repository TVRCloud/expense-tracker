import { describe, expect, it } from "vitest";
import { toBps, toMinor } from "./amount-input";

describe("toMinor", () => {
  it("reads whole and two-decimal amounts exactly", () => {
    expect(toMinor("1234.5")).toBe(123_450);
    expect(toMinor("0.07")).toBe(7);
    expect(toMinor("19.99")).toBe(1999);
    expect(toMinor(" 100 ")).toBe(10_000);
    expect(toMinor("1000000000000.00")).toBe(100_000_000_000_000);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "1e3", ".5", "5.", "10000000000000000"]) expect(toMinor(bad), bad).toBeNull();
  });
});

describe("toBps", () => {
  it("turns a rate in percent into basis points", () => {
    expect(toBps("7.25")).toBe(725);
    expect(toBps("8")).toBe(800);
    expect(toBps("0")).toBe(0);
    expect(toBps("100")).toBe(10_000);
  });
  it("refuses a rate over 100% or a bad number", () => {
    for (const bad of ["100.01", "101", "-1", "7.255", "x", ""]) expect(toBps(bad), bad).toBeNull();
  });
});
