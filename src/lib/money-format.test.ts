import { describe, expect, it } from "vitest";
import { formatMinor, formatMinorCompact, minorToMajor } from "@/lib/money-format";

describe("formatMinor", () => {
  it("follows the currency's own decimals", () => {
    expect(formatMinor(484500, "INR")).toBe("₹4,845.00");
    expect(formatMinor(123456, "USD")).toBe("$1,234.56");
    expect(formatMinor(5000, "JPY")).toBe("¥5,000");
    expect(formatMinor(12345, "KWD")).toContain("12.345");
    expect(formatMinor(-250, "JPY")).toContain("250");
    expect(formatMinor(-250, "JPY")).not.toContain(".");
  });

  it("compact keeps the same scale", () => {
    expect(formatMinorCompact(484500, "INR")).toBe("₹4.8K");
    expect(formatMinorCompact(5000000, "JPY")).toBe("¥5M");
  });
});

describe("minorToMajor", () => {
  it("divides by the currency's exponent", () => {
    expect(minorToMajor(5000, "JPY")).toBe(5000);
    expect(minorToMajor(123456, "USD")).toBe(1234.56);
    expect(minorToMajor(12345, "KWD")).toBe(12.345);
    expect(minorToMajor(-5300, "INR")).toBe(-53);
  });
});
