import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAuth } from "@/lib/auth-guard";
import { ensureLedgerBackfill, LEDGER_SCOPES } from "@/lib/ledger";
import { isLogsUnlocked } from "@/lib/log-security";
import logger from "@/lib/logger";
import LedgerBlock from "@/models/LedgerBlock";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const unlocked = await isLogsUnlocked(user.id, user.jti);
    if (!unlocked) {
      return NextResponse.json({ error: "Logs are locked" }, { status: 423 });
    }

    const { searchParams } = new URL(req.url);
    const skip = Math.max(parseInt(searchParams.get("skip") ?? "0", 10), 0);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10), 1), 100);
    const scope = searchParams.get("scope");
    const entityId = searchParams.get("entityId");

    if (scope && !LEDGER_SCOPES.includes(scope as (typeof LEDGER_SCOPES)[number])) {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    await connectDB();
    await ensureLedgerBackfill(user.id);

    const query: Record<string, unknown> = { user: user.id };
    if (scope) query.scope = scope;
    if (entityId) query.entityId = entityId;

    const [blocks, total] = await Promise.all([
      LedgerBlock.find(query).sort({ sequence: -1 }).skip(skip).limit(limit).lean(),
      LedgerBlock.countDocuments(query),
    ]);

    return NextResponse.json({ data: blocks, total, skip, limit });
  } catch (err) {
    logger.error({ err }, "GET /api/logs/ledger failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
