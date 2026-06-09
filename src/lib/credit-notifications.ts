import Notification from "@/models/Notification";
import CreditStatement from "@/models/CreditStatement";
import Transaction from "@/models/Transaction";
import { getCurrentCycle, getPastCycles, getDueDateStatus } from "@/lib/credit-card";
import { type ICreditMeta } from "@/types/models";
import logger from "@/lib/logger";
import { Types } from "mongoose";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

async function alreadySent(userId: string, type: string, key: string): Promise<boolean> {
  const existing = await Notification.findOne({
    user: userId,
    type,
    "meta.dedupKey": key,
    createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
  }).lean();
  return !!existing;
}

async function createNotif(userId: string, type: string, title: string, body: string, meta: Record<string, unknown>) {
  try {
    if (await alreadySent(userId, type, meta.dedupKey as string)) return;
    await Notification.create({ user: userId, type, title, body, meta });
  } catch (err) {
    logger.error({ err }, `Failed to create ${type} notification`);
  }
}

async function computeStatementBalance(userId: string, accountId: string, periodStart: Date, periodEnd: Date) {
  const accountObjectId = new Types.ObjectId(accountId);
  const [result] = await Transaction.aggregate([
    {
      $match: {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        $or: [{ account: accountObjectId }, { transferTo: accountObjectId }],
        date: { $gte: periodStart, $lte: periodEnd },
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
  return Math.max(0, result?.balance ?? 0);
}

export async function checkCreditDueNotifications(
  userId: string,
  accountId: string,
  accountName: string,
  creditMeta: ICreditMeta
): Promise<void> {
  try {
    if (!creditMeta.billingCycleDay || !creditMeta.paymentDueDay) return;

    const config = {
      billingCycleDay: creditMeta.billingCycleDay,
      paymentDueDay: creditMeta.paymentDueDay,
      creditLimit: creditMeta.creditLimit ?? 0,
      minPaymentPct: creditMeta.minPaymentPct ?? 2,
    };

    const cycle = getCurrentCycle(config);

    // Days until cycle closes
    const now = new Date();
    const cycleCloseMs = cycle.periodEnd.getTime() - now.getTime();
    const daysUntilClose = Math.round(cycleCloseMs / (1000 * 60 * 60 * 24));

    const cycleKey = cycle.periodEnd.toISOString().slice(0, 7); // YYYY-MM

    // Statement closing soon (≤ 3 days)
    if (daysUntilClose >= 0 && daysUntilClose <= 3) {
      await createNotif(
        userId,
        "credit_due",
        `${accountName} statement closing soon`,
        `Your ${accountName} statement closes in ${daysUntilClose === 0 ? "today" : `${daysUntilClose} day${daysUntilClose === 1 ? "" : "s"}`}.`,
        { accountId, dedupKey: `close-${accountId}-${cycleKey}` }
      );
    }

    const statementRecords = await CreditStatement.find({
      account: new Types.ObjectId(accountId),
      user: userId,
      isDeleted: { $ne: true },
    }).lean();
    const payableStatements = await Promise.all(
      getPastCycles(config, 12).map(async (pastCycle) => {
        const balance = await computeStatementBalance(userId, accountId, pastCycle.periodStart, pastCycle.periodEnd);
        const record = statementRecords.find((item) =>
          new Date(item.periodStart).getTime() === pastCycle.periodStart.getTime()
        );
        return {
          cycle: pastCycle,
          remainingDue: Math.max(0, balance - (record?.paidAmount ?? 0)),
        };
      })
    );
    const nextPayable = payableStatements
      .filter((statement) => statement.remainingDue > 0)
      .sort((a, b) => a.cycle.dueDate.getTime() - b.cycle.dueDate.getTime())[0];

    if (nextPayable) {
      const { daysUntilDue, isOverdue } = getDueDateStatus(nextPayable.cycle.dueDate);
      const payableKey = nextPayable.cycle.periodEnd.toISOString().slice(0, 7);

      if (!isOverdue && daysUntilDue >= 0 && daysUntilDue <= 7) {
        await createNotif(
          userId,
          "credit_due",
          `${accountName} payment due in ${daysUntilDue}d`,
          `Payment for your ${accountName} ${nextPayable.cycle.label} statement is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`,
          { accountId, dedupKey: `due-${accountId}-${payableKey}` }
        );
      }

      if (isOverdue) {
        await createNotif(
          userId,
          "credit_overdue",
          `${accountName} payment overdue`,
          `Payment for your ${accountName} ${nextPayable.cycle.label} statement is overdue.`,
          { accountId, dedupKey: `overdue-${accountId}-${payableKey}` }
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "checkCreditDueNotifications failed");
  }
}
