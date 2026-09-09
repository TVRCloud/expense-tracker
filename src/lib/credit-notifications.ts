import Notification from "@/models/Notification";
import { getDueDateStatus } from "@/lib/credit-card";
import { getCardCycleBalances, type CardCycleBalances } from "@/lib/credit-balance";
import { type ICreditMeta } from "@/types/models";
import logger from "@/lib/logger";
import { sendPushToUser } from "@/lib/push";

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
    void sendPushToUser(userId, { title, body, url: `/accounts/${meta.accountId as string}` });
  } catch (err) {
    logger.error({ err }, `Failed to create ${type} notification`);
  }
}

export async function checkCreditDueNotifications(
  userId: string,
  accountId: string,
  accountName: string,
  creditMeta: ICreditMeta,
  // Optional already-computed balances (see getCardCycleBalances) — pass
  // this when the caller just computed the same numbers itself (e.g. the
  // dashboard's credit-cards summary route) to avoid redoing the same
  // queries twice per request. Omitted by the cron path
  // (reminder-scheduler.ts), which has nothing to share it with and
  // computes standalone as before.
  precomputed?: CardCycleBalances
): Promise<void> {
  try {
    if (!creditMeta.billingCycleDay || !creditMeta.paymentDueDay) return;

    const config = {
      billingCycleDay: creditMeta.billingCycleDay,
      paymentDueDay: creditMeta.paymentDueDay,
      creditLimit: creditMeta.creditLimit ?? 0,
      minPaymentPct: creditMeta.minPaymentPct ?? 2,
    };

    const { currentCycle: cycle, pastCycles } = precomputed ?? (await getCardCycleBalances(userId, accountId, config));

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

    const nextPayable = pastCycles
      .filter((statement) => statement.remainingDue > 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

    if (nextPayable) {
      const { daysUntilDue, isOverdue } = getDueDateStatus(nextPayable.dueDate);
      const payableKey = nextPayable.periodEnd.toISOString().slice(0, 7);

      if (!isOverdue && daysUntilDue >= 0 && daysUntilDue <= 7) {
        await createNotif(
          userId,
          "credit_due",
          `${accountName} payment due in ${daysUntilDue}d`,
          `Payment for your ${accountName} ${nextPayable.label} statement is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`,
          { accountId, dedupKey: `due-${accountId}-${payableKey}` }
        );
      }

      if (isOverdue) {
        await createNotif(
          userId,
          "credit_overdue",
          `${accountName} payment overdue`,
          `Payment for your ${accountName} ${nextPayable.label} statement is overdue.`,
          { accountId, dedupKey: `overdue-${accountId}-${payableKey}` }
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "checkCreditDueNotifications failed");
  }
}
