import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { isValidObjectId, listTransactions } from "@/lib/transaction-query";
import { createTransaction, transactionCreateSchema, TransactionServiceError } from "@/lib/transaction-service";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const skip = parseInt(searchParams.get("skip") ?? "0", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);
    const type = searchParams.get("type");
    const category = searchParams.get("category");
    const accountId = searchParams.get("accountId");
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const hideFuture = searchParams.get("hideFuture") === "true";
    const includeUnpaidRecurring = searchParams.get("includeUnpaidRecurring") === "true";

    if (!isValidObjectId(accountId)) {
      return NextResponse.json({ error: "Invalid account" }, { status: 400 });
    }

    const result = await listTransactions({
      userId: user.id,
      skip,
      limit,
      type,
      category,
      accountId,
      search,
      dateFrom,
      dateTo,
      hideFuture,
      includeUnpaidRecurring,
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err }, "GET /api/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = transactionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await createTransaction({ ...parsed.data, userId: user.id, actor: user });

    if (result.kind === "series") {
      return NextResponse.json(
        { data: result.transaction, seriesId: result.seriesId, count: result.count },
        { status: 201 }
      );
    }
    return NextResponse.json({ data: result.transaction }, { status: 201 });
  } catch (err) {
    if (err instanceof TransactionServiceError) {
      const status = err.code === "ACCOUNT_NOT_FOUND" || err.code === "TRANSFER_ACCOUNT_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error({ err }, "POST /api/transactions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
