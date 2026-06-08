import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import CreditStatement from "@/models/CreditStatement";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { Types } from "mongoose";

const paySchema = z.object({
  paidAmount: z.number().int().positive(),
  paidAt: z.string().optional(),
  paymentTransactionId: z.string().optional(),
});

type Params = Promise<{ accountId: string; statementId: string }>;

async function computeStatementBalance(
  userId: string,
  accountId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  const accountObjectId = new Types.ObjectId(accountId);
  const result = await Transaction.aggregate([
    {
      $match: {
        user: new Types.ObjectId(userId),
        $or: [
          { account: accountObjectId },
          { transferTo: accountObjectId },
        ],
        date: { $gte: periodStart, $lte: periodEnd },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $eq: ["$type", "transfer"] },
                      { $eq: ["$transferTo", accountObjectId] },
                    ],
                  },
                  then: { $multiply: [-1, "$amount"] },
                },
                { case: { $eq: ["$type", "income"] }, then: { $multiply: [-1, "$amount"] } },
                {
                  case: {
                    $and: [
                      { $eq: ["$type", "transfer"] },
                      { $eq: ["$account", accountObjectId] },
                    ],
                  },
                  then: "$amount",
                },
                { case: { $eq: ["$type", "expense"] }, then: "$amount" },
              ],
              default: 0,
            },
          },
        },
      },
    },
  ]);

  return Math.max(0, result[0]?.total ?? 0);
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { accountId, statementId } = await params;
    const body = await req.json();
    const parsed = paySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();

    const existing = await CreditStatement.findOne({
      _id: statementId,
      account: accountId,
      user: user.id,
    }).lean<{
      paidAmount?: number;
      periodStart: Date;
      periodEnd: Date;
      dueDate: Date;
    }>();

    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const statementBalance = await computeStatementBalance(
      user.id,
      accountId,
      new Date(existing.periodStart),
      new Date(existing.periodEnd)
    );
    const paidAmount = (existing.paidAmount ?? 0) + parsed.data.paidAmount;
    const isPaid = statementBalance === 0 || paidAmount >= statementBalance;
    const now = new Date();
    const unpaidStatus = new Date(existing.dueDate) < now ? "overdue" : "closed";

    const update: Record<string, unknown> = {
      isPaid,
      status: isPaid ? "paid" : unpaidStatus,
      paidAmount,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
    };
    if (parsed.data.paymentTransactionId) {
      update.paymentTransactionId = new Types.ObjectId(parsed.data.paymentTransactionId);
    }

    const statement = await CreditStatement.findOneAndUpdate(
      { _id: statementId, account: accountId, user: user.id },
      { $set: update },
      { new: true }
    ).lean();

    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

    logger.info({ userId: user.id, statementId }, "Credit statement marked paid");
    return NextResponse.json({ data: statement });
  } catch (err) {
    logger.error({ err }, "PATCH /api/credit-cards/[accountId]/statements/[statementId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
