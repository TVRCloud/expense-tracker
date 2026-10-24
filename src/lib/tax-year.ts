import { DEFAULT_TIME_ZONE, isValidTimeZone, localDate, localMidnight } from "@/lib/spend-limit-time";

// India's financial year runs 1 April to 31 March. It is named by the year it
// starts in: fy 2025 is 2025-26. Boundaries are the user's own midnight, so a
// spend at 00:30 IST on 1 April belongs to the new year even though it is
// still 31 March in UTC.

export const MIN_FY = 2000;
export const MAX_FY = 2100;

function zoneOf(timeZone: string) {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/** The financial year that contains this instant on the user's wall clock. */
export function currentFy(now: Date, timeZone: string): number {
  const { year, month } = localDate(now, zoneOf(timeZone));
  return month >= 4 ? year : year - 1;
}

/** [start, end): the UTC instants of 1 April and the next 1 April in the zone. */
export function fyBounds(fy: number, timeZone: string): { start: Date; end: Date } {
  const tz = zoneOf(timeZone);
  return { start: localMidnight(tz, fy, 4, 1), end: localMidnight(tz, fy + 1, 4, 1) };
}

export function fyLabel(fy: number): string {
  return `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

/** "YYYY-MM" for each of the 12 months, April first. */
export function fyMonthKeys(fy: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1;
    const year = month >= 4 ? fy : fy + 1;
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return keys;
}

export function isValidFy(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_FY && value <= MAX_FY;
}

/** Parses the `fy` query value: a whole year, or null for "not a valid year". */
export function parseFy(raw: string): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const n = Number(raw);
  return isValidFy(n) ? n : null;
}
