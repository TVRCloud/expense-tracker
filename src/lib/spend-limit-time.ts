// Day, week and month boundaries in a user's IANA time zone. A spend limit
// resets at the user's midnight, not the server's.

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; dayOfWeek: number };

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
}

function localParts(date: Date, timeZone: string): LocalParts & { minute: number; second: number } {
  const get: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") get[p.type] = parseInt(p.value, 10);
  }
  const dayOfWeek = new Date(Date.UTC(get.year, get.month - 1, get.day)).getUTCDay();
  return { year: get.year, month: get.month, day: get.day, hour: get.hour, minute: get.minute, second: get.second, dayOfWeek };
}

// How far the zone is ahead of UTC at this instant, in ms.
function offsetAt(ms: number, timeZone: string) {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = localParts(new Date(whole), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

// The UTC instant at which the local calendar day y-m-d starts. Where a clock
// change skips midnight (America/Santiago, Asia/Beirut: 00:00 becomes 01:00),
// the day starts at the first instant that exists, not an hour before it on the
// day before.
export function localMidnight(timeZone: string, year: number, month: number, day: number) {
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetAt(wall, timeZone);
  const guess = wall - offsetAt(first, timeZone);
  const wallDayAt = (ms: number) => {
    const p = localParts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  if (wallDayAt(guess) >= wall) return new Date(guess);
  // guess is still on the day before; the day has started by guess + 24 h.
  let lo = guess;
  let hi = guess + 86_400_000;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (wallDayAt(mid) >= wall) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** The calendar date on the user's wall clock at this instant (dayOfWeek: 0 is Sunday). */
export function localDate(date: Date, timeZone: string) {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const { year, month, day, dayOfWeek } = localParts(date, tz);
  return { year, month, day, dayOfWeek };
}

/** "YYYY-MM-DD" for the user's wall-clock date at this instant. */
export function localDateKey(date: Date, timeZone: string) {
  const { year, month, day } = localDate(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The hour (0-23) on the user's wall clock. */
export function localHour(now: Date, timeZone: string) {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return localParts(now, tz).hour;
}

export type DayWindow = {
  dayStart: Date;
  dayEnd: Date;
  weekStart: Date;
  weekEnd: Date;
  monthEnd: Date;
  yesterdayStart: Date;
  daysLeftInMonth: number; // including today
  year: number;
  month: number;
};

export function dayWindow(now: Date, timeZone: string, weekStartsOn = 0): DayWindow {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const p = localParts(now, tz);
  const dayStart = localMidnight(tz, p.year, p.month, p.day);
  const dayEnd = localMidnight(tz, p.year, p.month, p.day + 1);
  const back = (p.dayOfWeek - weekStartsOn + 7) % 7;
  const weekStart = localMidnight(tz, p.year, p.month, p.day - back);
  const weekEnd = localMidnight(tz, p.year, p.month, p.day - back + 7);
  const monthEnd = localMidnight(tz, p.year, p.month + 1, 1);
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return {
    dayStart,
    dayEnd,
    weekStart,
    weekEnd,
    monthEnd,
    yesterdayStart: localMidnight(tz, p.year, p.month, p.day - 1),
    daysLeftInMonth: daysInMonth - p.day + 1,
    year: p.year,
    month: p.month,
  };
}
