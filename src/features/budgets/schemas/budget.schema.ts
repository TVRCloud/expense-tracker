import { z } from "zod";

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
  limitAmount: z.number().int().positive("Enter an amount greater than 0"),
  alertAt: z.number().min(1).max(100).default(80),
  rollover: z.boolean().default(false),
});

export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;
