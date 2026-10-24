import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { createRule, listRules, RuleServiceError, ruleCreateSchema, ruleErrorStatus } from "@/lib/rule-service";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listRules(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/rules failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const parsed = ruleCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await createRule({ ...parsed.data, userId: user.id }) }, { status: 201 });
  } catch (err) {
    if (err instanceof RuleServiceError) {
      return NextResponse.json({ error: err.message }, { status: ruleErrorStatus(err.code) });
    }
    logger.error({ err }, "POST /api/rules failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
