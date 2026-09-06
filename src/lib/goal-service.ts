import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";

// Shared with POST /api/goals (browser) and the integration route.

export const goalCreateSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmount: z.number().int().positive(),
  savedAmount: z.number().int().min(0).default(0),
  targetDate: z.string().optional(),
  linkedAccount: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export type CreateGoalInput = z.infer<typeof goalCreateSchema> & { userId: string; actor: AuthUser };

export async function createGoal(input: CreateGoalInput) {
  const { userId, actor, ...rest } = input;
  await connectDB();

  const goal = await Goal.create({
    ...rest,
    user: userId,
    targetDate: rest.targetDate ? new Date(rest.targetDate) : undefined,
  });
  await appendLedgerBlock({
    userId,
    scope: "goal",
    entityId: goal._id.toString(),
    action: "create",
    after: goal,
    actor,
  });

  return goal;
}
