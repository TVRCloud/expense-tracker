import connectDB from "@/lib/mongodb";
import Goal from "@/models/Goal";
import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk, integrationError } from "@/lib/integrations/response";
import { withIdempotency } from "@/lib/integrations/idempotency";
import { createGoal, goalCreateSchema } from "@/lib/goal-service";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

// GET /api/integrations/goals — same query as GET /api/goals, uncached
// (parity with the existing route, which does no server-side progress calc
// either — savedAmount/targetAmount are returned raw).
export const GET = withIntegrationRoute("goals", async ({ user, requestId }) => {
  await connectDB();
  const goals = await Goal.find({ user: user.id, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .lean();

  return integrationOk(goals, requestId);
});

// POST /api/integrations/goals — reuses the exact same createGoal() service
// as the browser's POST /api/goals.
export const POST = withIntegrationRoute("goals", async ({ req, user, requestId }) => {
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return integrationError("VALIDATION_ERROR", "Missing or invalid Idempotency-Key header", requestId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return integrationError("VALIDATION_ERROR", "Request body must be valid JSON", requestId);
  }
  const parsed = goalCreateSchema.safeParse(body);
  if (!parsed.success) {
    return integrationError("VALIDATION_ERROR", "Goal data is invalid", requestId, { details: parsed.error.flatten() });
  }

  const outcome = await withIdempotency({
    userId: user.id,
    endpoint: "integrations:goals:POST",
    key: idempotencyKey,
    body: parsed.data,
    execute: async () => {
      const goal = await createGoal({ ...parsed.data, userId: user.id, actor: user });
      return { status: 201, body: goal as unknown as Record<string, unknown> };
    },
  });

  if (outcome.kind === "conflict") {
    return integrationError(
      "IDEMPOTENCY_CONFLICT",
      outcome.reason === "fingerprint_mismatch"
        ? "Idempotency-Key was already used with a different request body"
        : "A request with this Idempotency-Key is still in progress; retry shortly",
      requestId
    );
  }

  return integrationOk(outcome.body, requestId, { status: outcome.status });
});
