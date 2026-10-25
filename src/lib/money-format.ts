import { minorExponent } from "@/lib/currency";

// Display an amount held in minor units of `currency`, using that currency's
// own number of decimals (JPY 0, INR 2, KWD 3). utils.ts formatCurrency
// assumes 2 for everything; pages that can show another base currency use this.

const localeFor = (currency: string) => (currency === "INR" ? "en-IN" : "en-US");

export function formatMinor(minor: number, currency: string): string {
  const exponent = minorExponent(currency);
  return new Intl.NumberFormat(localeFor(currency), {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

export function formatMinorCompact(minor: number, currency: string): string {
  return new Intl.NumberFormat(localeFor(currency), {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minor / 10 ** minorExponent(currency));
}

/** Minor units as a plain decimal number for a CSV cell: 12345 KWD is 12.345, 5000 JPY is 5000. */
export function minorToMajor(minor: number, currency: string): number {
  const exponent = minorExponent(currency);
  return Number((minor / 10 ** exponent).toFixed(exponent));
}
