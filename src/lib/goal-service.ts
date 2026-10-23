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

export class GoalServiceError extends Error {
  code: "GOAL_NOT_FOUND";
  constructor(code: "GOAL_NOT_FOUND", message: string) {
    super(message);
    this.code = code;
    this.name = "GoalServiceError";
  }
}

export const goalUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetAmount: z.number().int().positive().optional(),
  savedAmount: z.number().int().min(0).optional(),
  targetDate: z.string().optional(),
  icon: z.string().optional(),
  isCompleted: z.boolean().optional(),
  roundUpEnabled: z.boolean().optional(),
  roundUpTo: z.number().int().positive().optional(),
});

export type UpdateGoalInput = z.infer<typeof goalUpdateSchema> & { userId: string; goalId: string; actor: AuthUser };

// Shared with PATCH /api/goals/[id] (browser) and the integration route.
// Fires the goal_reached notification when the update completes the goal.
export async function updateGoal(input: UpdateGoalInput) {
  const { userId, goalId, actor, ...changes } = input;
  const update: Record<string, unknown> = { ...changes };
  if (changes.targetDate) update.targetDate = new Date(changes.targetDate);

  await connectDB();
  const filter = { _id: goalId, user: userId, isDeleted: { $ne: true } };
  const before = await Goal.findOne(filter).lean();
  if (!before) throw new GoalServiceError("GOAL_NOT_FOUND", "Goal not found");

  // Only one goal can have round-up active at a time: enabling it here
  // disables it everywhere else for this user first.
  if (changes.roundUpEnabled === true) {
    await Goal.updateMany({ user: userId, _id: { $ne: goalId } }, { $set: { roundUpEnabled: false } });
  }

  const goal = await Goal.findOneAndUpdate(filter, { $set: update }, { new: true }).lean<GoalCompletionCheck>();
  if (!goal) throw new GoalServiceError("GOAL_NOT_FOUND", "Goal not found");

  await appendLedgerBlock({ userId, scope: "goal", entityId: goalId, action: "update", before, after: goal, actor });
  await checkGoalCompletion(userId, goal, actor);
  return goal;
}

// Soft delete, shared with DELETE /api/goals/[id] and the integration route.
export async function deleteGoal(userId: string, goalId: string, actor: AuthUser) {
  await connectDB();
  const filter = { _id: goalId, user: userId, isDeleted: { $ne: true } };
  const before = await Goal.findOne(filter).lean();
  if (!before) throw new GoalServiceError("GOAL_NOT_FOUND", "Goal not found");
  const goal = await Goal.findOneAndUpdate(
    filter,
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: userId } },
    { new: true }
  ).lean();
  if (!goal) throw new GoalServiceError("GOAL_NOT_FOUND", "Goal not found");

  await appendLedgerBlock({ userId, scope: "goal", entityId: goalId, action: "delete", before, after: goal, actor });
}
