import { NextRequest, NextResponse } from "next/server";
import { promoteStalePendingSms } from "@/lib/capture/ingest";
import { isAuthorizedCron } from "@/lib/cron-auth";
import logger from "@/lib/logger";

// GET /api/cron/promote-captures — turns app notifications whose SMS never
// arrived into transactions (src/lib/capture/ingest.ts). On the custom
// server this also runs every 5 minutes from server.ts; on Vercel, where
// that timer doesn't exist, call this from any scheduler (e.g. an n8n
// Schedule node every 5 minutes) with `Authorization: Bearer $CRON_SECRET`.
// It also runs lazily on every capture upload and review-inbox read.
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { promoted } = await promoteStalePendingSms();
  logger.info({ promoted }, "Cron: pending-SMS promotion completed");
  return NextResponse.json({ ok: true, promoted });
}
