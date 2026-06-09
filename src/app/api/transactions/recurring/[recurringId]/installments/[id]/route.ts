import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { Types } from "mongoose";
import { z } from "zod";
import { redis } from "@/lib/redis";
import { checkBudgetAlert } from "@/lib/budget-alert";
import { appendLedgerBlock } from "@/lib/ledger";

type Params = Promise<{ recurringId: string; id: string }>;

const patchSchema = z.object({
  status: z.enum(["paid", "skipped", "upcoming", "overdue"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { recurringId, id } = await params;
    await connectDB();

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const installment = await Transaction.findOne({
      _id: id,
      user: user.id,
      isDeleted: { $ne: true },
      recurringId: new Types.ObjectId(recurringId),
    });

    if (!installment) {
      return NextResponse.json({ error: "Installment not found" }, { status: 404 });
    }

    const { status } = parsed.data;
    const installmentBefore = installment.toObject();
    const prevStatus = installment.installmentStatus;
    const now = new Date();
    const installmentDate = new Date(installment.date);

    // Apply balance delta when marking paid — all installments, regardless of date
    if (status === "paid" && prevStatus !== "paid") {
      const delta = installment.type === "income" ? installment.amount : -installment.amount;
      const accountBefore = await Account.findOne({ _id: installment.account, user: user.id });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: installment.account, user: user.id },
        { $inc: { balance: delta } },
        { new: true }
      );
      if (accountBefore && accountAfter) {
        await appendLedgerBlock({
          userId: user.id,
          scope: "account",
          entityId: accountAfter._id.toString(),
          action: "update",
          before: accountBefore,
          after: accountAfter,
          actor: user,
        });
      }
    }

    // Reverse balance if un-paying
    if (prevStatus === "paid" && status !== "paid") {
      const delta = installment.type === "income" ? -installment.amount : installment.amount;
      const accountBefore = await Account.findOne({ _id: installment.account, user: user.id });
      const accountAfter = await Account.findOneAndUpdate(
        { _id: installment.account, user: user.id },
        { $inc: { balance: delta } },
        { new: true }
      );
      if (accountBefore && accountAfter) {
        await appendLedgerBlock({
          userId: user.id,
          scope: "account",
          entityId: accountAfter._id.toString(),
          action: "update",
          before: accountBefore,
          after: accountAfter,
          actor: user,
        });
      }
    }

    installment.installmentStatus = status;
    installment.paidAt = status === "paid" ? now : undefined;
    await installment.save();
    await appendLedgerBlock({
      userId: user.id,
      scope: "transaction",
      entityId: installment._id.toString(),
      action: "update",
      before: installmentBefore,
      after: installment,
      actor: user,
    });

    if (status === "paid" && prevStatus !== "paid" && installment.type === "expense") {
      void checkBudgetAlert(user.id, installment.category, installment.amount);
    }

    // Invalidate Redis cache for this installment's month
    try {
      await redis?.del(`stats:v2:${user.id}:${installmentDate.getFullYear()}:${installmentDate.getMonth() + 1}`);
    } catch {
      // ignore
    }

    return NextResponse.json({ data: installment });
  } catch (err) {
    logger.error({ err }, "PATCH installment status failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
