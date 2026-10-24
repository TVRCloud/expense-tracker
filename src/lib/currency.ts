// Pure currency rules: which codes are accepted, how many minor-unit digits
// each has, and the one place a foreign amount becomes base-currency paise.
// No I/O here. Rates come from exchange-rate-service.ts.

// ISO 4217 codes the app accepts. Default is 2 minor-unit digits; the others
// are listed in EXPONENT_OVERRIDES.
export const SUPPORTED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "JOD",
  "SGD", "MYR", "THB", "IDR", "PHP", "VND", "JPY", "KRW", "CNY", "HKD", "TWD",
  "AUD", "NZD", "CAD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY",
  "ZAR", "EGP", "NGN", "KES", "LKR", "NPR", "BDT", "PKR", "BRL", "MXN", "ARS",
  "CLP", "ILS", "RUB",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

const EXPONENT_OVERRIDES: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3,
};

const SUPPORTED = new Set<string>(SUPPORTED_CURRENCIES);

// Largest amount, in minor units, that is stored or produced (1e13 paise is
// 100 billion rupees). Keeps every product below Number.MAX_SAFE_INTEGER.
export const MAX_MINOR_AMOUNT = 1e13;
// Sanity bounds for a base-per-1-original rate.
export const MIN_RATE = 1e-9;
export const MAX_RATE = 1e9;

export function isSupportedCurrency(code: unknown): code is CurrencyCode {
  return typeof code === "string" && SUPPORTED.has(code);
}

/** Digits after the decimal point for the currency (JPY 0, INR 2, KWD 3). */
export function minorExponent(code: string): number {
  return EXPONENT_OVERRIDES[code] ?? 2;
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export class CurrencyError extends Error {
  code: "INVALID_RATE" | "AMOUNT_OUT_OF_RANGE" | "RATE_OUT_OF_BAND";
  constructor(code: CurrencyError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CurrencyError";
  }
}

/** A rate kept to 10 significant digits so it is stable when stored and read back. */
export function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
    throw new CurrencyError("INVALID_RATE", "Exchange rate is out of range");
  }
  return Number(rate.toPrecision(10));
}

/**
 * Convert an amount in the original currency's minor units to the base
 * currency's minor units. `rate` is base units per 1 unit of the original.
 * Exact: the 10-digit rate is split into an integer mantissa and a power of
 * ten, and everything is done in BigInt, rounding half up once at the end.
 * Throws when the result is below 1 or above the cap.
 */
export function convertMinor(originalAmount: number, from: string, base: string, rate: number): number {
  if (!Number.isSafeInteger(originalAmount) || originalAmount < 1 || originalAmount > MAX_MINOR_AMOUNT) {
    throw new CurrencyError("AMOUNT_OUT_OF_RANGE", "Amount is out of range");
  }
  const r = normalizeRate(rate);
  // r = mantissa * 10^(exp - 9), the mantissa having 10 digits.
  const [mantissaText, expText] = r.toExponential(9).split("e");
  const mantissa = BigInt(mantissaText!.replace(".", ""));
  const power = Number(expText) - 9 + (minorExponent(base) - minorExponent(from));
  let numerator = BigInt(originalAmount) * mantissa;
  let out: bigint;
  if (power >= 0) {
    out = numerator * BigInt(10) ** BigInt(power);
  } else {
    const divisor = BigInt(10) ** BigInt(-power);
    numerator *= BigInt(2);
    out = (numerator + divisor) / (BigInt(2) * divisor);
  }
  if (out < BigInt(1)) {
    throw new CurrencyError("AMOUNT_OUT_OF_RANGE", "Converted amount is too small");
  }
  if (out > BigInt(MAX_MINOR_AMOUNT)) {
    throw new CurrencyError("AMOUNT_OUT_OF_RANGE", "Converted amount is too large");
  }
  return Number(out);
}
