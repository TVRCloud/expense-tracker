import { z } from "zod";

// Single source of truth for goal-create validation — imported by both the
// client form (GoalsClient.tsx, via react-hook-form) and the server service
// (src/lib/goal-service.ts re-exports this), so client and server enforce
// identical rules. Lives here (not in goal-service.ts) because that file
// also imports server-only mongoose/mongodb code that must never reach a
// client bundle.
export const goalCreateSchema = z.object({
  name: z.string().min(1, "Name your goal").max(100),
  targetAmount: z.number().int().positive("Enter a target greater than 0"),
  savedAmount: z.number().int().min(0).default(0),
  targetDate: z.string().optional(),
  icon: z.string().optional(),
});

export type GoalCreateInput = z.infer<typeof goalCreateSchema>;
