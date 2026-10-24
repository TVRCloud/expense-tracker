import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { deleteRule, RuleServiceError, ruleErrorStatus, ruleUpdateSchema, updateRule } from "@/lib/rule-service";

type Params = Promise<{ id: string }>;

function serviceError(err: RuleServiceError) {
  return NextResponse.json({ error: err.message }, { status: ruleErrorStatus(err.code) });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });

    const parsed = ruleUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ data: await updateRule({ ...parsed.data, userId: user.id, ruleId: id }) });
  } catch (err) {
    if (err instanceof RuleServiceError) return serviceError(err);
    logger.error({ err }, "PATCH /api/rules/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });

    await deleteRule(user.id, id);
    return NextResponse.json({ data: { id, deleted: true } });
  } catch (err) {
    if (err instanceof RuleServiceError) return serviceError(err);
    logger.error({ err }, "DELETE /api/rules/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
