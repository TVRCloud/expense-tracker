import { z } from "zod";
import { MAX_MINOR_AMOUNT } from "@/lib/currency";

// Single source of truth for budget-create validation — imported by both the
// client form (BudgetsClient.tsx, via react-hook-form) and the server
// service (src/lib/budget-service.ts re-exports this), so client and server
// enforce identical rules. Lives here (not in budget-service.ts) because
// that file also imports server-only mongoose/mongodb code that must never
// reach a client bundle.
export const budgetCreateSchema = z.object({
  category: z.string().min(1, "Pick a category"),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  limitAmount: z.number().int().positive("Enter an amount greater than 0").max(MAX_MINOR_AMOUNT),
  alertAt: z.number().min(1).max(100).default(80),
  rollover: z.boolean().default(false),
});

export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;

// Categories offered when creating a budget or excluding spend from a limit.
export const BUDGET_CATEGORIES = [
  "groceries","transport","rent","health","shopping","coffee","education",
  "entertainment","gym","travel","subscription","other",
] as const;
