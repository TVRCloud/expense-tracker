import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { Types } from "mongoose";
import { appendLedgerBlock } from "@/lib/ledger";
import { getDueDateForStatementClose } from "@/lib/credit-card";

const paySchema = z.object({
  paidAmount: z.number().int().positive(),
  paidAt: z.string().optional(),
  paymentTransactionId: z.string().optional(),
  sourceAccountId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.paymentTransactionId && !Types.ObjectId.isValid(data.paymentTransactionId)) {
    ctx.addIssue({ code: "custom", path: ["paymentTransactionId"], message: "Invalid payment transaction" });
  }
  if (data.sourceAccountId && !Types.ObjectId.isValid(data.sourceAccountId)) {
    ctx.addIssue({ code: "custom", path: ["sourceAccountId"], message: "Invalid source account" });
  }
  if (data.sourceAccountId && data.paymentTransactionId) {
    ctx.addIssue({ code: "custom", path: ["sourceAccountId"], message: "Provide source account or payment transaction, not both" });
  }
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
        isDeleted: { $ne: true },
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
                      { $eq: ["$account", accountObjectId] },
                    ],
                  },
                  then: "$amount",
                },
                { case: { $eq: ["$type", "income"] }, then: { $multiply: [-1, "$amount"] } },
                {
                  case: {
                    $and: [
                      { $eq: ["$type", "transfer"] },
                      { $eq: ["$transferTo", accountObjectId] },
                    ],
                  },
                  then: 0,
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
    if (!Types.ObjectId.isValid(accountId) || !Types.ObjectId.isValid(statementId)) {
      return NextResponse.json({ error: "Invalid statement" }, { status: 400 });
    }
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
      isDeleted: { $ne: true },
    }).lean<{
      paidAmount?: number;
      periodStart: Date;
      periodEnd: Date;
      dueDate: Date;
    }>();

    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cardForConfig = await Account.findOne({ _id: accountId, user: user.id, type: "credit_card", isArchived: false }).lean<{
      creditMeta?: { paymentDueDay?: number };
    }>();
    if (!cardForConfig?.creditMeta?.paymentDueDay) {
      return NextResponse.json({ error: "Credit card billing cycle is not configured" }, { status: 400 });
    }

    const statementBalance = await computeStatementBalance(
      user.id,
      accountId,
      new Date(existing.periodStart),
      new Date(existing.periodEnd)
    );
    const paidAmount = (existing.paidAmount ?? 0) + parsed.data.paidAmount;
    const isPaid = statementBalance === 0 || paidAmount >= statementBalance;
    const now = new Date();
    const dueDate = getDueDateForStatementClose(cardForConfig.creditMeta.paymentDueDay, new Date(existing.periodEnd));
    const unpaidStatus = dueDate < now ? "overdue" : "closed";

    const paymentDate = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();
    const update: Record<string, unknown> = {
      isPaid,
      status: isPaid ? "paid" : unpaidStatus,
      paidAmount,
      paidAt: paymentDate,
      dueDate,
    };
    if (parsed.data.paymentTransactionId) {
      update.paymentTransactionId = new Types.ObjectId(parsed.data.paymentTransactionId);
    }
    if (parsed.data.sourceAccountId) {
      if (parsed.data.sourceAccountId === accountId) {
        return NextResponse.json({ error: "Source account must be different from credit card" }, { status: 400 });
      }

      const [sourceAccount, cardAccount] = await Promise.all([
        Account.findOne({ _id: parsed.data.sourceAccountId, user: user.id, isArchived: false }),
        Account.findOne({ _id: accountId, user: user.id, type: "credit_card", isArchived: false }),
      ]);
      if (!sourceAccount) return NextResponse.json({ error: "Source account not found" }, { status: 404 });
      if (!cardAccount) return NextResponse.json({ error: "Credit card account not found" }, { status: 404 });
      if (sourceAccount.type === "credit_card") {
        return NextResponse.json({ error: "Source account cannot be a credit card" }, { status: 400 });
      }

      const sourceBefore = sourceAccount.toObject();
      const cardBefore = cardAccount.toObject();
      sourceAccount.balance -= parsed.data.paidAmount;
      cardAccount.balance += parsed.data.paidAmount;
      await Promise.all([sourceAccount.save(), cardAccount.save()]);
      await appendLedgerBlock({
        userId: user.id,
        scope: "account",
        entityId: sourceAccount._id.toString(),
        action: "update",
        before: sourceBefore,
        after: sourceAccount,
        actor: user,
      });
      await appendLedgerBlock({
        userId: user.id,
        scope: "account",
        entityId: cardAccount._id.toString(),
        action: "update",
        before: cardBefore,
        after: cardAccount,
        actor: user,
      });

      const paymentTransaction = await Transaction.create({
        user: user.id,
        account: parsed.data.sourceAccountId,
        type: "transfer",
        amount: parsed.data.paidAmount,
        currency: cardAccount.currency ?? "USD",
        category: "Transfer",
        description: `Payment to ${cardAccount.name}`,
        date: paymentDate,
        transferTo: accountId,
        tags: [`credit_statement:${statementId}`],
      });
      await appendLedgerBlock({
        userId: user.id,
        scope: "transaction",
        entityId: paymentTransaction._id.toString(),
        action: "create",
        after: paymentTransaction,
        actor: user,
      });
      update.paymentTransactionId = paymentTransaction._id;
    }

    const statement = await CreditStatement.findOneAndUpdate(
      { _id: statementId, account: accountId, user: user.id, isDeleted: { $ne: true } },
      { $set: update },
      { new: true }
    ).lean();

    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "credit_statement",
      entityId: statementId,
      action: "update",
      before: existing,
      after: statement,
      actor: user,
    });

    logger.info({ userId: user.id, statementId }, "Credit statement marked paid");
    return NextResponse.json({ data: statement });
  } catch (err) {
    logger.error({ err }, "PATCH /api/credit-cards/[accountId]/statements/[statementId] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
