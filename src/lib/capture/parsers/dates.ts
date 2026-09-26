// Date handling for bank messages. Indian banks write dates in local time
// (IST, UTC+05:30) with no zone, in many shapes: "26-09-26", "26/09/2026",
// "26 Sep 2026", "26-Sep-26", "26Sep26", "2026-09-26". Most include no time
// of day, so the time is taken from when the phone received the message.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const MONTH_PATTERN = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

export interface ParsedDate {
  date: Date;
  hasTime: boolean;
}

function fullYear(y: number) {
  return y < 100 ? 2000 + y : y;
}

/** Wall-clock IST components to a real instant. */
export function istToDate(year: number, monthIndex: number, day: number, hours = 12, minutes = 0): Date {
  return new Date(Date.UTC(year, monthIndex, day, hours, minutes) - IST_OFFSET_MS);
}

/** The IST calendar day of an instant, as "yyyy-mm-dd". */
export function istDayKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istClock(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return { hours: shifted.getUTCHours(), minutes: shifted.getUTCMinutes() };
}

function validDay(y: number, m: number, d: number) {
  if (m < 0 || m > 11 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m, d));
  return probe.getUTCMonth() === m && probe.getUTCDate() === d;
}

function findTime(text: string): { hours: number; minutes: number } | null {
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?\b/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function findCalendarDate(text: string): { y: number; m: number; d: number } | null {
  // 2026-09-26
  let match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (match) return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };

  // 26 Sep 2026 / 26-Sep-26 / 26Sep26 / 26-SEP-2026
  match = text.match(new RegExp(`\\b(\\d{1,2})[\\s-]?(${MONTH_PATTERN})[a-z]*[\\s,-]?(\\d{2,4})\\b`, "i"));
  if (match) {
    const m = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    return { y: fullYear(Number(match[3])), m, d: Number(match[1]) };
  }

  // 26-09-26 / 26/09/2026 / 26.09.26 (Indian day-first order)
  match = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (match) return { y: fullYear(Number(match[3])), m: Number(match[2]) - 1, d: Number(match[1]) };

  return null;
}

/**
 * The payment's date from the message, in IST. Without a time in the text,
 * the time comes from receivedAt when it falls on the same IST day (the usual
 * case: the SMS arrives seconds after the payment), otherwise noon IST.
 * hasTime is true only when the message itself states the time.
 * Returns null when no valid date is found, so the caller can lower its
 * confidence instead of silently using "now".
 */
export function parseMessageDate(text: string, receivedAt: Date): ParsedDate | null {
  const cal = findCalendarDate(text);
  if (!cal || !validDay(cal.y, cal.m, cal.d)) return null;

  const time = findTime(text);
  if (time) {
    return { date: istToDate(cal.y, cal.m, cal.d, time.hours, time.minutes), hasTime: true };
  }

  const dayKey = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}-${String(cal.d).padStart(2, "0")}`;
  if (istDayKey(receivedAt) === dayKey) {
    // The time is borrowed from receivedAt, not stated in the message, so
    // hasTime stays false: cross-channel matching then compares by day,
    // which tolerates an SMS that arrives late.
    const clock = istClock(receivedAt);
    return { date: istToDate(cal.y, cal.m, cal.d, clock.hours, clock.minutes), hasTime: false };
  }
  return { date: istToDate(cal.y, cal.m, cal.d), hasTime: false };
}
