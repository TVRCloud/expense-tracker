import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { Types } from "mongoose";
import {
  deleteTransaction,
  transactionUpdateSchema,
  TransactionServiceError,
  updateTransaction,
} from "@/lib/transaction-service";

type Params = Promise<{ id: string }>;

function statusForError(code: string) {
  if (code === "TRANSACTION_NOT_FOUND") return 404;
  if (code === "TRANSACTION_LOCKED") return 409;
  return 400;
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    await connectDB();
    const txn = await Transaction.findOne({ _id: id, user: user.id, isDeleted: { $ne: true } }).lean();
    if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ data: txn });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    const body = await req.json();
    const parsed = transactionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const txn = await updateTransaction({ ...parsed.data, userId: user.id, transactionId: id, actor: user });
    return NextResponse.json({ data: txn });
  } catch (err) {
    if (err instanceof TransactionServiceError) {
      return NextResponse.json({ error: err.message }, { status: statusForError(err.code) });
    }
    logger.error({ err }, "PATCH /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }

    await deleteTransaction(user.id, id, user);
    return NextResponse.json({ data: { message: "Transaction deleted" } });
  } catch (err) {
    if (err instanceof TransactionServiceError) {
      return NextResponse.json({ error: err.message }, { status: statusForError(err.code) });
    }
    logger.error({ err }, "DELETE /api/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
