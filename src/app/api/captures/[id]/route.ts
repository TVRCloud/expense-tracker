import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { discardCapture } from "@/lib/reconcile/inbox";
import { webReconcileError } from "@/lib/reconcile/http";

type Params = Promise<{ id: string }>;

// DELETE /api/captures/:id — discard a queued message. The record is kept
// (status "discarded"), never deleted.
export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    await discardCapture(user.id, id);
    return NextResponse.json({ data: { message: "Discarded" } });
  } catch (err) {
    return webReconcileError(err, "DELETE /api/captures/[id]");
  }
}
