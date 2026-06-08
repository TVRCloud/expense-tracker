import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Notification from "@/models/Notification";
import { sendPushToUser } from "@/lib/push";
import logger from "@/lib/logger";
import { formatCurrency } from "@/lib/utils";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

async function alreadySent(userId: string, key: string): Promise<boolean> {
  const existing = await Notification.findOne({
    user: userId,
    type: "emi_due",
    "meta.dedupKey": key,
    createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
  }).lean();
  return !!existing;
}

export async function checkEmiDueNotifications(userId: string): Promise<void> {
  try {
    await connectDB();

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 2); // include day-before + same-day

    const upcoming = await Transaction.find({
      user: userId,
      isRecurring: true,
      installmentStatus: "upcoming",
      date: { $gte: now, $lte: tomorrow },
    }).lean();

    for (const tx of upcoming) {
      const txDate = new Date(tx.date);
      txDate.setHours(0, 0, 0, 0);
      const diffDays = Math.round((txDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const txId = String(tx._id);
      const dateISO = txDate.toISOString().slice(0, 10);
      const label = tx.recurrenceLabel ?? tx.description ?? tx.category;
      const amountStr = formatCurrency(tx.amount);
      const url = tx.recurringId ? `/transactions/recurring/${String(tx.recurringId)}` : "/transactions";

      if (diffDays === 0) {
        const key = `emi-day-${txId}-${dateISO}`;
        if (!(await alreadySent(userId, key))) {
          await sendPushToUser(userId, {
            title: `EMI due today: ${amountStr} ${label}`,
            body: "Tap to mark as paid",
            url,
          });
          await Notification.create({
            user: userId,
            type: "emi_due",
            title: `EMI due today: ${label}`,
            body: `Your ${label} installment of ${amountStr} is due today.`,
            meta: { dedupKey: key, transactionId: txId },
          });
        }
      } else if (diffDays === 1) {
        const key = `emi-before-${txId}-${dateISO}`;
        if (!(await alreadySent(userId, key))) {
          await sendPushToUser(userId, {
            title: `EMI due tomorrow: ${amountStr} ${label}`,
            body: "Tap to view installment details",
            url,
          });
          await Notification.create({
            user: userId,
            type: "emi_due",
            title: `EMI due tomorrow: ${label}`,
            body: `Your ${label} installment of ${amountStr} is due tomorrow.`,
            meta: { dedupKey: key, transactionId: txId },
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "checkEmiDueNotifications failed");
  }
}
