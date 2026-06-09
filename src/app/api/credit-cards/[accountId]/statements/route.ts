import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getCurrentCycle, getPastCycles, computeMinPayment, getDueDateForStatementClose } from "@/lib/credit-card";
import { checkCreditDueNotifications } from "@/lib/credit-notifications";
import { type ICreditMeta } from "@/types/models";
import { Types } from "mongoose";
import { appendLedgerBlock } from "@/lib/ledger";

type Params = Promise<{ accountId: string }>;

async function computeStatementBalance(userId: string, accountId: string, periodStart: Date, periodEnd: Date): Promise<number> {
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

export async function GET(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { accountId } = await params;
    await connectDB();

    const account = await Account.findOne({ _id: accountId, user: user.id }).lean();
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (account.type !== "credit_card") {
      return NextResponse.json({ error: "Not a credit card account" }, { status: 400 });
    }

    const meta = account.creditMeta as {
      billingCycleDay?: number;
      paymentDueDay?: number;
      creditLimit?: number;
      minPaymentPct?: number;
    } | undefined;

    if (!meta?.billingCycleDay || !meta?.paymentDueDay) {
      return NextResponse.json({
        data: [],
        currentCycle: null,
        message: "Billing cycle not configured",
      });
    }

    const config = {
      billingCycleDay: meta.billingCycleDay,
      paymentDueDay: meta.paymentDueDay,
      creditLimit: meta.creditLimit ?? 0,
      minPaymentPct: meta.minPaymentPct ?? 2,
    };

    // Fire-and-forget notification checks (non-blocking)
    void checkCreditDueNotifications(user.id, accountId, account.name, meta as ICreditMeta);

    // Current open cycle (no DB record)
    const current = getCurrentCycle(config);
    const currentBalance = await computeStatementBalance(user.id, accountId, current.periodStart, current.periodEnd);

    // Past 12 closed cycles
    const pastCycles = getPastCycles(config, 12);

    // Lazy-create statement records for past cycles that don't have one yet
    for (const cycle of pastCycles) {
      const existingStatement = await CreditStatement.findOne({
        account: new Types.ObjectId(accountId),
        periodStart: cycle.periodStart,
        isDeleted: { $ne: true },
      });
      if (!existingStatement) {
        const statement = await CreditStatement.create({
          user: new Types.ObjectId(user.id),
          account: new Types.ObjectId(accountId),
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          dueDate: cycle.dueDate,
          status: cycle.dueDate < new Date() ? "overdue" : "closed",
          isPaid: false,
          paidAmount: 0,
        });
        await appendLedgerBlock({
          userId: user.id,
          scope: "credit_statement",
          entityId: statement._id.toString(),
          action: "create",
          after: statement,
          actor: user,
        });
      }
    }

    // Fetch all statement records
    const statements = await CreditStatement.find({
      account: new Types.ObjectId(accountId),
      user: user.id,
      isDeleted: { $ne: true },
    })
      .sort({ periodStart: -1 })
      .lean();

    // Enrich with computed balance
    const enriched = await Promise.all(
      statements.map(async (s) => {
        const statementBalance = await computeStatementBalance(
          user.id,
          accountId,
          new Date(s.periodStart),
          new Date(s.periodEnd)
        );
        const paidAmount = s.paidAmount ?? 0;
        const remainingDue = Math.max(0, statementBalance - paidAmount);
        const minPayment = computeMinPayment(remainingDue, config.minPaymentPct);
        const dueDate = getDueDateForStatementClose(config.paymentDueDay, new Date(s.periodEnd));
        const isPayable = remainingDue > 0;

        // Auto-update status if stale
        let status = s.status as string;
        if (remainingDue === 0) {
          status = "paid";
        } else {
          const now = new Date();
          if (dueDate < now) status = "overdue";
          else if (new Date(s.periodEnd) < now) status = "closed";
        }

        return {
          ...s,
          dueDate,
          balance: statementBalance,
          statementBalance,
          paidAmount,
          remainingDue,
          isPayable,
          isPaid: remainingDue === 0,
          minPayment,
          status,
        };
      })
    );

    // Hide empty cycles — no transactions and never paid
    const filtered = enriched.filter(s => s.statementBalance > 0 || s.paidAmount > 0);
    const payableStatementDue = filtered.reduce((sum, statement) => sum + statement.remainingDue, 0);

    return NextResponse.json({
      data: filtered,
      currentCycle: {
        balance: currentBalance,
        unbilledUsage: currentBalance,
        payableStatementDue,
        totalOutstanding: currentBalance + payableStatementDue,
        minPayment: 0,
        periodStart: current.periodStart.toISOString(),
        periodEnd: current.periodEnd.toISOString(),
        dueDate: current.dueDate.toISOString(),
        label: current.label,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/[accountId]/statements failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
