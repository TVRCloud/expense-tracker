import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import Notification from "@/models/Notification";
import type { AuthUser } from "@/lib/auth-guard";
import { appendLedgerBlock } from "@/lib/ledger";
import { goalCreateSchema } from "@/features/goals/schemas/goal.schema";

interface GoalCompletionCheck {
  _id: unknown;
  name: string;
  savedAmount: number;
  targetAmount: number;
  isCompleted: boolean;
}

// Shared by PATCH /api/goals/[id] and applyRoundUp() below — one place that
// decides "did this goal just get reached" and fires the ledger entry +
// notification, instead of duplicating the check at every savedAmount
// write site.
export async function checkGoalCompletion(userId: string, goal: GoalCompletionCheck, actor: AuthUser) {
  if (goal.isCompleted || goal.savedAmount < goal.targetAmount) return;
  const entityId = String(goal._id);
  const completedGoal = await Goal.findByIdAndUpdate(
    goal._id,
    { $set: { isCompleted: true, completedAt: new Date() } },
    { new: true }
  ).lean();
  await appendLedgerBlock({
    userId,
    scope: "goal",
    entityId,
    action: "update",
    before: goal,
    after: completedGoal,
    actor,
  });
  await Notification.create({
    user: userId,
    type: "goal_reached",
    title: "Goal reached! 🎉",
    body: `Congratulations! You've reached your "${goal.name}" goal.`,
    meta: { goalId: entityId },
  });
}

// Hooked into transaction-service.ts's expense-creation path (fire-and-forget,
// same pattern as checkBudgetAlert). Finds the user's one round-up-enabled
// goal (at most one, enforced in the PATCH route below) and atomically
// increments its savedAmount — deliberately NOT going through the PATCH
// route's $set, since that's a read-then-write race on every transaction.
export async function applyRoundUp(userId: string, expenseAmountCents: number, actor: AuthUser) {
  await connectDB();
  const target = await Goal.findOne({
    user: userId,
    roundUpEnabled: true,
    isCompleted: false,
    isDeleted: { $ne: true },
  }).lean<{ _id: unknown; name: string; savedAmount: number; targetAmount: number; roundUpTo: number; isCompleted: boolean }>();
  if (!target) return;

  const roundTo = target.roundUpTo || 100;
  const remainder = expenseAmountCents % roundTo;
  if (remainder === 0) return;
  const delta = roundTo - remainder;

  const updated = await Goal.findOneAndUpdate(
    { _id: target._id },
    { $inc: { savedAmount: delta } },
    { new: true }
  ).lean<{ _id: unknown; name: string; savedAmount: number; targetAmount: number; isCompleted: boolean }>();
  if (!updated) return;

  await appendLedgerBlock({
    userId,
    scope: "goal",
    entityId: String(target._id),
    action: "update",
    before: target,
    after: updated,
    actor,
  });
  await checkGoalCompletion(userId, updated, actor);
}

// Shared with POST /api/goals (browser) and the integration route.
export { goalCreateSchema };

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
