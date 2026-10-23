import { z } from "zod";

// Single source of truth for spend-limit validation: the settings dialog
// (SpendLimitCard.tsx) and the server (src/lib/spend-limit.ts re-exports this)
// enforce the same rules. Lives here, not in spend-limit.ts, because that file
// imports server-only mongoose code that must never reach a client bundle.
export const spendLimitUpdateSchema = z.object({
  // null clears the limit.
  dailyAmount: z.number().int().positive().nullable().optional(),
  weeklyAmount: z.number().int().positive().nullable().optional(),
  alertAt: z.number().int().min(1).max(100).optional(),
  excludeCategories: z.array(z.string().min(1).max(60)).max(50).optional(),
  rollover: z.boolean().optional(),
  // null resumes the limit now.
  pausedUntil: z.string().datetime().nullable().optional(),
});

export type SpendLimitUpdate = z.infer<typeof spendLimitUpdateSchema>;

export type LimitBar = { spent: number; limit: number | null; left: number | null; percent: number | null };

// Shape of GET and PUT /api/spend-limit (src/lib/spend-limit.ts).
export type SpendLimitStatus = {
  settings: {
    dailyAmount: number | null;
    weeklyAmount: number | null;
    alertAt: number;
    excludeCategories: string[];
    rollover: boolean;
    pausedUntil: string | null;
  };
  timezone: string;
  paused: boolean;
  today: LimitBar;
  week: LimitBar;
  safeToSpend: number | null;
};

/** "250" or "250.5" rupees to integer cents; null for blank, NaN for anything else. */
export function rupeesToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(parseFloat(trimmed) * 100);
}

/** Cents to the text shown in an amount input; blank when there is no limit. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return Number.isInteger(cents / 100) ? String(cents / 100) : (cents / 100).toFixed(2);
}

export type PauseChoice = "keep" | "resume" | "1" | "3" | "7";

/** ISO time for a pause of N days from now, null to resume, undefined to leave as is. */
export function pausedUntilFor(choice: PauseChoice, now = new Date()): string | null | undefined {
  if (choice === "keep") return undefined;
  if (choice === "resume") return null;
  return new Date(now.getTime() + Number(choice) * 24 * 60 * 60 * 1000).toISOString();
}
