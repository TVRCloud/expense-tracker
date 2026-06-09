import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { ensureLedgerBackfill, verifyLedgerChain } from "@/lib/ledger";
import { isLogsUnlocked } from "@/lib/log-security";
import logger from "@/lib/logger";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const unlocked = await isLogsUnlocked(user.id, user.jti);
    if (!unlocked) {
      return NextResponse.json({ error: "Logs are locked" }, { status: 423 });
    }

    await ensureLedgerBackfill(user.id);
    const result = await verifyLedgerChain(user.id);
    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "GET /api/logs/ledger/verify failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
