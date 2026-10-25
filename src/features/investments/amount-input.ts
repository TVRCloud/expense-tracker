// Reading what a person types into the investment forms, without a float in between.

/** "1234.5" -> 123450 minor units, without going through a float. Null when it is not a plain amount with at most two decimals. */
export function toMinor(text: string): number | null {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** "7.25" -> 725 basis points. */
export function toBps(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : null;
}

