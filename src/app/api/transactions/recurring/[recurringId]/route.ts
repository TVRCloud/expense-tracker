import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { cancelRecurringSeries, getRecurringSeries } from "@/lib/recurring-series";

type Params = Promise<{ recurringId: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId } = await params;
    const found = await getRecurringSeries(user.id, recurringId);
    if (!found) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    return NextResponse.json({ data: found.installments, series: found.series });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/recurring/[recurringId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId } = await params;
    return NextResponse.json({ data: await cancelRecurringSeries(user.id, recurringId, user) });
  } catch (err) {
    logger.error({ err }, "DELETE /api/transactions/recurring/[recurringId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
