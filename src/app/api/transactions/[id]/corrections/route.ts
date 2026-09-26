import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { correctionRequestSchema, correctTransaction } from "@/lib/reconcile/correct";
import { getTransactionProvenance } from "@/lib/reconcile/inbox";
import { webReconcileError } from "@/lib/reconcile/http";

type Params = Promise<{ id: string }>;

// GET /api/transactions/:id/corrections — where this transaction's values
// came from (every captured message, source of truth first) and its
// correction history.
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    return NextResponse.json({ data: await getTransactionProvenance(user.id, id) });
  } catch (err) {
    return webReconcileError(err, "GET /api/transactions/[id]/corrections");
  }
}

// POST /api/transactions/:id/corrections — "Something's wrong": fix the
// values in place and keep a correction record. Body {changes, reason, note?};
// reason "duplicate" / "not_a_transaction" voids it.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;

    const parsed = correctionRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const { transaction, correction } = await correctTransaction({
      userId: user.id,
      transactionId: id,
      ...parsed.data,
      via: "web",
      actor: user,
    });
    return NextResponse.json({ data: { transaction, correctionId: correction._id.toString() } }, { status: 201 });
  } catch (err) {
    return webReconcileError(err, "POST /api/transactions/[id]/corrections");
  }
}
