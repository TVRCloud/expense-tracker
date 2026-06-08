import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { getCurrentCycle, computeUtilization, getDueDateStatus } from "@/lib/credit-card";
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
      return NextResponse.json({ data: { totalDebt: 0, cards: [] } });
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

        // Compute current cycle balance from card charges and payments.
        const cardObjectId = new Types.ObjectId(String(card._id));
        const result = await Transaction.aggregate([
          {
            $match: {
              user: new Types.ObjectId(user.id),
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
                            { $eq: ["$transferTo", cardObjectId] },
                          ],
                        },
                        then: { $multiply: [-1, "$amount"] },
                      },
                      { case: { $eq: ["$type", "income"] }, then: { $multiply: [-1, "$amount"] } },
                      {
                        case: {
                          $and: [
                            { $eq: ["$type", "transfer"] },
                            { $eq: ["$account", cardObjectId] },
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

        const balance = Math.max(0, result[0]?.balance ?? 0);
        const utilization = computeUtilization(balance, config.creditLimit);
        const dueStatus = getDueDateStatus(cycle.dueDate);

        return {
          accountId: String(card._id),
          name: card.name,
          balance,
          creditLimit: config.creditLimit,
          utilization,
          nextDueDate: cycle.dueDate.toISOString(),
          daysUntilDue: dueStatus.daysUntilDue,
          isOverdue: dueStatus.isOverdue,
          status: "open",
          network: meta.network,
          lastFourDigits: meta.lastFourDigits,
        };
      })
    );

    const totalDebt = cardSummaries.reduce((s, c) => s + c.balance, 0);

    return NextResponse.json({ data: { totalDebt, cards: cardSummaries } });
  } catch (err) {
    logger.error({ err }, "GET /api/credit-cards/summary failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
