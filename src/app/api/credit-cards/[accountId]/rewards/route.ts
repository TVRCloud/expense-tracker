import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { CreditCardServiceError } from "@/lib/credit-card-service";
import { rewardRuleSchema } from "@/lib/card-rewards";
import { clearRewardRule, getCardRewards, setRewardRule } from "@/lib/card-rewards-service";

type Params = Promise<{ accountId: string }>;

function failure(err: unknown, label: string) {
  if (err instanceof CreditCardServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.code === "ACCOUNT_NOT_FOUND" ? 404 : 400 });
  }
  logger.error({ err }, label);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { accountId } = await params;
    const raw = req.nextUrl.searchParams.get("cycles");
    const cycles = raw == null ? 3 : Number(raw);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 12) {
      return NextResponse.json({ error: "cycles must be a whole number from 1 to 12" }, { status: 400 });
    }
    return NextResponse.json(await getCardRewards(user.id, accountId, cycles));
  } catch (err) {
    return failure(err, "GET /api/credit-cards/[accountId]/rewards failed");
  }
}

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { accountId } = await params;
    const parsed = rewardRuleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Reward rule is invalid", details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ rule: await setRewardRule(user.id, accountId, parsed.data) });
  } catch (err) {
    return failure(err, "PUT /api/credit-cards/[accountId]/rewards failed");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { accountId } = await params;
    await clearRewardRule(user.id, accountId);
    return NextResponse.json({ id: accountId, deleted: true });
  } catch (err) {
    return failure(err, "DELETE /api/credit-cards/[accountId]/rewards failed");
  }
}
