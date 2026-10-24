import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getSplit, replaceSplits, splitUpdateSchema } from "@/lib/split-service";
import { TransactionServiceError } from "@/lib/transaction-service";

type Params = Promise<{ id: string }>;

function statusFor(code: string) {
  if (code === "TRANSACTION_NOT_FOUND") return 404;
  if (code === "TRANSACTION_LOCKED" || code === "SPLIT_CONFLICT" || code === "TOO_MANY_RECEIPTS") return 409;
  return 400;
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    return NextResponse.json({ data: await getSplit(user.id, id) });
  } catch (err) {
    if (err instanceof TransactionServiceError) return NextResponse.json({ error: err.message }, { status: statusFor(err.code) });
    logger.error({ err }, "GET /api/transactions/[id]/splits failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const parsed = splitUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const data = await replaceSplits({ userId: user.id, transactionId: id, splits: parsed.data.splits, actor: user });
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof TransactionServiceError) return NextResponse.json({ error: err.message }, { status: statusFor(err.code) });
    logger.error({ err }, "PUT /api/transactions/[id]/splits failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
