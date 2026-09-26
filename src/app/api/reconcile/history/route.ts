import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { listCorrectionHistory } from "@/lib/reconcile/inbox";
import { webReconcileError } from "@/lib/reconcile/http";

// GET /api/reconcile/history — every correction, newest first.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await listCorrectionHistory(user.id) });
  } catch (err) {
    return webReconcileError(err, "GET /api/reconcile/history");
  }
}
