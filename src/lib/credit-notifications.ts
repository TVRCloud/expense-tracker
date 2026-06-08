import Notification from "@/models/Notification";
import { getCurrentCycle, getDueDateStatus } from "@/lib/credit-card";
import { type ICreditMeta } from "@/types/models";
import logger from "@/lib/logger";

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
    const { daysUntilDue, isOverdue } = getDueDateStatus(cycle.dueDate);

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

    // Payment due soon (≤ 7 days) but not yet overdue
    if (!isOverdue && daysUntilDue >= 0 && daysUntilDue <= 7) {
      await createNotif(
        userId,
        "credit_due",
        `${accountName} payment due in ${daysUntilDue}d`,
        `Payment for your ${accountName} ${cycle.label} statement is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`,
        { accountId, dedupKey: `due-${accountId}-${cycleKey}` }
      );
    }

    // Overdue
    if (isOverdue) {
      await createNotif(
        userId,
        "credit_overdue",
        `${accountName} payment overdue`,
        `Payment for your ${accountName} ${cycle.label} statement is overdue.`,
        { accountId, dedupKey: `overdue-${accountId}-${cycleKey}` }
      );
    }
  } catch (err) {
    logger.error({ err }, "checkCreditDueNotifications failed");
  }
}
