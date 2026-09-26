import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { resolveCapture, resolveCaptureSchema } from "@/lib/reconcile/inbox";
import { webReconcileError } from "@/lib/reconcile/http";

type Params = Promise<{ id: string }>;

// POST /api/captures/:id/resolve — act on a queued message: "create",
// "link", "keep_mine" or "use_sms" (see resolveCaptureSchema).
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;

    const parsed = resolveCaptureSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = await resolveCapture({ userId: user.id, captureId: id, input: parsed.data, actor: user, via: "web" });
    return NextResponse.json({ data });
  } catch (err) {
    return webReconcileError(err, "POST /api/captures/[id]/resolve");
  }
}
