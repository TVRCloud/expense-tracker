import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { deleteReceipt, getReceiptImage, receiptErrorStatus, receiptImageHeaders, ReceiptServiceError } from "@/lib/receipt-service";

type Params = Promise<{ id: string }>;

// The image, for the signed-in owner only. Another user's receipt answers 404.
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    const { contentType, bytes } = await getReceiptImage(user.id, id);
    return new Response(new Uint8Array(bytes), { status: 200, headers: receiptImageHeaders(contentType, bytes.length) });
  } catch (err) {
    if (err instanceof ReceiptServiceError) {
      return NextResponse.json({ error: err.message }, { status: receiptErrorStatus(err.code) });
    }
    logger.error({ err }, "GET /api/receipts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await params;
    await deleteReceipt(user.id, id);
    return NextResponse.json({ data: { id, deleted: true } });
  } catch (err) {
    if (err instanceof ReceiptServiceError) {
      return NextResponse.json({ error: err.message }, { status: receiptErrorStatus(err.code) });
    }
    logger.error({ err }, "DELETE /api/receipts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
