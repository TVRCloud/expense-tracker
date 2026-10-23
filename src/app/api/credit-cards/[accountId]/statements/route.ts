import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { CreditCardServiceError, getCardStatements } from "@/lib/credit-card-service";

type Params = Promise<{ accountId: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { accountId } = await params;
    return NextResponse.json(await getCardStatements(user, accountId));
  } catch (err) {
    if (err instanceof CreditCardServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "ACCOUNT_NOT_FOUND" ? 404 : 400 });
    }
    logger.error({ err }, "GET /api/credit-cards/[accountId]/statements failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
