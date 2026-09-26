import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getReviewInbox } from "@/lib/reconcile/inbox";
import { webReconcileError } from "@/lib/reconcile/http";

// GET /api/reconcile — review inbox for the web reconcile page.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getReviewInbox(user.id) });
  } catch (err) {
    return webReconcileError(err, "GET /api/reconcile");
  }
}
