import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { setInstallmentStatus, TransactionServiceError } from "@/lib/transaction-service";

type Params = Promise<{ recurringId: string; id: string }>;

const patchSchema = z.object({
  status: z.enum(["paid", "skipped", "upcoming", "overdue"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId, id } = await params;

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const installment = await setInstallmentStatus(user.id, recurringId, id, parsed.data.status, user);
    return NextResponse.json({ data: installment });
  } catch (err) {
    if (err instanceof TransactionServiceError) {
      const status = err.code === "INSTALLMENT_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error({ err }, "PATCH installment status failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
