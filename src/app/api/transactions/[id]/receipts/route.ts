import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { addReceipt, listReceipts, MAX_RECEIPT_BYTES, preflightReceipt, readReceiptBody, ReceiptServiceError, receiptErrorStatus } from "@/lib/receipt-service";

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    return NextResponse.json({ data: await listReceipts(user.id, id) });
  } catch (err) {
    if (err instanceof ReceiptServiceError) {
      return NextResponse.json({ error: err.message }, { status: receiptErrorStatus(err.code) });
    }
    logger.error({ err }, "GET /api/transactions/[id]/receipts failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// The request body is the raw image (JPEG, PNG, WebP or HEIC, up to 3 MB); its type is read from the file.
export async function POST(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    const declared = Number(req.headers.get("content-length"));
    await preflightReceipt(user.id, id, Number.isFinite(declared) ? declared : undefined);
    const read = await readReceiptBody(req, user.id, MAX_RECEIPT_BYTES);
    if (!read.ok) {
      if (read.reason === "busy") return NextResponse.json({ error: "Another upload is still being received; try again in a moment" }, { status: 429, headers: { "Retry-After": "5" } });
      if (read.reason === "timeout") return NextResponse.json({ error: "The upload took too long" }, { status: 408 });
      return NextResponse.json({ error: `A receipt can be at most ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB` }, { status: 413 });
    }
    const receipt = await addReceipt({ userId: user.id, transactionId: id, bytes: read.bytes });
    return NextResponse.json({ data: receipt }, { status: 201 });
  } catch (err) {
    if (err instanceof ReceiptServiceError) {
      return NextResponse.json({ error: err.message }, { status: receiptErrorStatus(err.code) });
    }
    logger.error({ err }, "POST /api/transactions/[id]/receipts failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
