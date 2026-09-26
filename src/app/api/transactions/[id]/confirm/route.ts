import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { confirmTransaction } from "@/lib/reconcile/correct";
import { webReconcileError } from "@/lib/reconcile/http";

type Params = Promise<{ id: string }>;

// POST /api/transactions/:id/confirm — mark an auto-captured transaction as
// reviewed and correct ("Looks right").
export async function POST(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    const data = await confirmTransaction(user.id, id, user);
    return NextResponse.json({ data });
  } catch (err) {
    return webReconcileError(err, "POST /api/transactions/[id]/confirm");
  }
}
