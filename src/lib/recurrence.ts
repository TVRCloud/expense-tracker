import { addDays, addWeeks, addMonths, addYears } from "date-fns";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

// Number of upcoming rows kept materialized for an open-ended (no end date/count) series.
// Topped back up to this window by topUpRecurringSeries as installments get consumed.
export const OPEN_ENDED_WINDOW = 3;

export function getDateAdder(frequency: string): (d: Date, n: number) => Date {
  switch (frequency) {
    case "daily": return (d, n) => addDays(d, n);
    case "weekly": return (d, n) => addWeeks(d, n);
    case "yearly": return (d, n) => addYears(d, n);
    default: return (d, n) => addMonths(d, n); // monthly
  }
}

export function computeInstallmentDates(
  startDate: Date,
  frequency: string,
  interval: number,
  count: number
): Date[] {
  const adder = getDateAdder(frequency);
  return Array.from({ length: count }, (_, i) => adder(startDate, interval * i));
}
