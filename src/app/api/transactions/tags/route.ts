import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { listTags } from "@/lib/transaction-query";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listTags(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/tags failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
