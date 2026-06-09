import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import CreditStatement from "@/models/CreditStatement";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getCurrentCycle, getPastCycles, computeUtilization, getDueDateStatus } from "@/lib/credit-card";
import { checkCreditDueNotifications } from "@/lib/credit-notifications";
import { type ICreditMeta } from "@/types/models";
import { Types } from "mongoose";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();

    const cards = await Account.find({
      user: user.id,
      type: "credit_card",
      isArchived: false,
    }).lean();

    if (cards.length === 0) {
      return NextResponse.json({
        data: {
          totalDebt: 0,
          totalPayableStatementDue: 0,
          totalUnbilledUsage: 0,
          totalCreditExposure: 0,
          totalAvailableCredit: 0,
          cards: [],
        },
      });
    }

    const cardSummaries = await Promise.all(
      cards.map(async (card) => {
        const meta = card.creditMeta as {
          billingCycleDay?: number;
          paymentDueDay?: number;
          creditLimit?: number;
          minPaymentPct?: number;
          network?: string;
          lastFourDigits?: string;
        } | undefined;

        if (!meta?.billingCycleDay || !meta?.paymentDueDay) {
          return {
            accountId: String(card._id),
            name: card.name,
            balance: 0,
            unbilledUsage: 0,
            payableStatementDue: 0,
            creditLimit: meta?.creditLimit ?? 0,
            utilization: 0,
            nextDueDate: null,
            daysUntilDue: null,
            isOverdue: false,
            status: "unconfigured",
            network: meta?.network,
            lastFourDigits: meta?.lastFourDigits,
          };
        }

        const config = {
          billingCycleDay: meta.billingCycleDay,
          paymentDueDay: meta.paymentDueDay,
          creditLimit: meta.creditLimit ?? 0,
          minPaymentPct: meta.minPaymentPct ?? 2,
        };

        const cycle = getCurrentCycle(config);

        // Fire-and-forget notification checks (non-blocking)
        void checkCreditDueNotifications(user.id, String(card._id), card.name, meta as ICreditMeta);

        // Compute unbilled open-cycle usage. Statement payment transfers do not reduce this.
        const cardObjectId = new Types.ObjectId(String(card._id));
        const result = await Transaction.aggregate([
          {
            $match: {
              user: new Types.ObjectId(user.id),
              isDeleted: { $ne: true },
              $or: [
                { account: cardObjectId },
                { transferTo: cardObjectId },
              ],
              date: { $gte: cycle.periodStart, $lte: cycle.periodEnd },
            },
          },
          {
            $group: {
              _id: null,
              balance: {
                $sum: {
                  $switch: {
                    branches: [
                      {
                        case: {
                          $and: [
                            { $eq: ["$type", "transfer"] },
                            { $eq: ["$account", cardObjectId] },
                          ],
                        },
                        then: "$amount",
                      },
                      { case: { $eq: ["$type", "income"] }, then: { $multiply: [-1, "$amount"] } },
                      {
                        case: {
                          $and: [
                            { $eq: ["$type", "transfer"] },
                            { $eq: ["$transferTo", cardObjectId] },
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

        const unbilledUsage = Math.max(0, result[0]?.balance ?? 0);
        const statementRecords = await CreditStatement.find({
          account: cardObjectId,
          user: user.id,
          isDeleted: { $ne: true },
        }).lean();
        const payableStatements = await Promise.all(
          getPastCycles(config, 12).map(async (pastCycle) => {
            const [statementResult] = await Transaction.aggregate([
              {
                $match: {
                  user: new Types.ObjectId(user.id),
                  isDeleted: { $ne: true },
                  $or: [{ account: cardObjectId }, { transferTo: cardObjectId }],
                  date: { $gte: pastCycle.periodStart, $lte: pastCycle.periodEnd },
                },
              },
              {
                $group: {
                  _id: null,
                  balance: {
                    $sum: {
                      $switch: {
                        branches: [
                          {
                            case: {
                              $and: [
                                { $eq: ["$type", "transfer"] },
                                { $eq: ["$account", cardObjectId] },
                              ],
                            },
                            then: "$amount",
                          },
                          { case: { $eq: ["$type", "income"] }, then: { $multiply: [-1, "$amount"] } },
                          {
                            case: {
                              $and: [
                                { $eq: ["$type", "transfer"] },
                                { $eq: ["$transferTo", cardObjectId] },
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
            const statementBalance = Math.max(0, statementResult?.balance ?? 0);
            const record = statementRecords.find((item) =>
              new Date(item.periodStart).getTime() === pastCycle.periodStart.getTime()
            );
            const remainingDue = Math.max(0, statementBalance - (record?.paidAmount ?? 0));
            return { ...pastCycle, remainingDue };
          })
        );
        const unpaidStatements = payableStatements
          .filter((statement) => statement.remainingDue > 0)
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        const payableStatementDue = unpaidStatements.reduce((sum, statement) => sum + statement.remainingDue, 0);
        const balance = unbilledUsage + payableStatementDue;
        const utilization = computeUtilization(balance, config.creditLimit);
        const nextPayable = unpaidStatements[0] ?? null;
        const dueStatus = nextPayable ? getDueDateStatus(nextPayable.dueDate) : null;

        return {
          accountId: String(card._id),
          name: card.name,
          balance,
          unbilledUsage,
          payableStatementDue,
          creditLimit: config.creditLimit,
          utilization,
          nextDueDate: nextPayable ? nextPayable.dueDate.toISOString() : null,
          daysUntilDue: dueStatus?.daysUntilDue ?? null,
          isOverdue: dueStatus?.isOverdue ?? false,
          status: nextPayable ? (dueStatus?.isOverdue ? "overdue" : "closed") : "open",
          network: meta.network,
          lastFourDigits: meta.lastFourDigits,
        };
      })
    );

    const totalPayableStatementDue = cardSummaries.reduce((s, c) => s + (c.payableStatementDue ?? 0), 0);
    const totalUnbilledUsage = cardSummaries.reduce((s, c) => s + (c.unbilledUsage ?? 0), 0);
    const totalCreditExposure = totalPayableStatementDue + totalUnbilledUsage;
    const totalCreditLimit = cardSummaries.reduce((s, c) => s + c.creditLimit, 0);
    const totalAvailableCredit = Math.max(0, totalCreditLimit - totalCreditExposure);
    const totalDebt = totalCreditExposure;

    return NextResponse.json({
      data: {
        totalDebt,
        totalPayableStatementDue,
        totalUnbilledUsage,
        totalCreditExposure,
        totalAvailableCredit,
        cards: cardSummaries,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/summary failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
