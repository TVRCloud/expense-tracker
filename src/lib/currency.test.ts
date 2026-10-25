import { describe, expect, it } from "vitest";
import {
  convertMinor,
  CurrencyError,
  isSupportedCurrency,
  MAX_MINOR_AMOUNT,
  minorExponent,
  normalizeRate,
  SUPPORTED_CURRENCIES,
} from "@/lib/currency";

describe("currency table", () => {
  it("knows the minor-unit digits", () => {
    expect(minorExponent("INR")).toBe(2);
    expect(minorExponent("USD")).toBe(2);
    expect(minorExponent("JPY")).toBe(0);
    expect(minorExponent("KWD")).toBe(3);
  });

  it("only accepts listed codes, in capitals", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("XYZ")).toBe(false);
    expect(isSupportedCurrency(5)).toBe(false);
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
  });
});

describe("normalizeRate", () => {
  it("keeps 10 significant digits and rejects nonsense", () => {
    expect(normalizeRate(1 / 3)).toBe(0.3333333333);
    expect(() => normalizeRate(0)).toThrow(CurrencyError);
    expect(() => normalizeRate(-1)).toThrow(CurrencyError);
    expect(() => normalizeRate(Number.NaN)).toThrow(CurrencyError);
    expect(() => normalizeRate(Infinity)).toThrow(CurrencyError);
    expect(() => normalizeRate(1e10)).toThrow(CurrencyError);
  });
});

describe("convertMinor", () => {
  it("converts cents to paise: 12.34 USD at 84.5 is 1042.73 INR", () => {
    expect(convertMinor(1234, "USD", "INR", 84.5)).toBe(104273);
  });

  it("handles zero-digit currencies on either side", () => {
    // 1000 JPY at 0.56 INR per yen is 560.00 INR.
    expect(convertMinor(1000, "JPY", "INR", 0.56)).toBe(56000);
    // 100.00 INR at 1.78 JPY per rupee is 178 JPY.
    expect(convertMinor(10000, "INR", "JPY", 1.78)).toBe(178);
  });

  it("handles three-digit currencies", () => {
    // 1.500 KWD at 270 INR is 405.00 INR.
    expect(convertMinor(1500, "KWD", "INR", 270)).toBe(40500);
  });

  it("rounds half up, once", () => {
    // 0.01 USD at 84.5 = 0.845 INR = 84.5 paise, rounds to 85.
    expect(convertMinor(1, "USD", "INR", 84.5)).toBe(85);
    expect(convertMinor(1, "USD", "INR", 84.49)).toBe(84);
  });

  it("is exact where floating point is not: 103700 JPY at 142.01895 is 1472736512 paise", () => {
    // 103700 * 142.01895 * 100 is 1472736511.4999998 in doubles; exactly it is ...512 (.5 rounds up).
    expect(convertMinor(103700, "JPY", "INR", 142.01895)).toBe(1472736512);
    expect(convertMinor(25, "USD", "INR", 0.1)).toBe(3);
    expect(convertMinor(5, "USD", "INR", 0.1)).toBe(1);
    expect(convertMinor(333333, "USD", "INR", 0.003)).toBe(1000);
    expect(convertMinor(999999999, "KWD", "INR", 0.3333333333)).toBe(33333333);
    expect(convertMinor(1, "JPY", "KWD", 0.0005)).toBe(1);
    expect(convertMinor(700, "USD", "JPY", 0.5)).toBe(4);
  });

  it("rejects amounts that round to nothing or are out of range", () => {
    expect(() => convertMinor(1, "JPY", "INR", 0.001)).toThrow(CurrencyError);
    expect(() => convertMinor(0, "USD", "INR", 84)).toThrow(CurrencyError);
    expect(() => convertMinor(1.5, "USD", "INR", 84)).toThrow(CurrencyError);
    expect(() => convertMinor(MAX_MINOR_AMOUNT + 1, "USD", "INR", 84)).toThrow(CurrencyError);
    expect(() => convertMinor(MAX_MINOR_AMOUNT, "USD", "INR", 84)).toThrow(CurrencyError);
  });
});
