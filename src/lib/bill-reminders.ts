import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import User from "@/models/User";
import { sendPushToUser } from "@/lib/push";
import logger from "@/lib/logger";
import { formatCurrency } from "@/lib/utils";
import { localHour, DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/spend-limit-time";
import { listUpcomingBills, type Bill } from "@/lib/bills";
import { DEFAULT_BILL_REMINDER_SETTINGS } from "@/lib/bill-settings";

// One reminder per bill per due date, sent from REMIND_FROM_HOUR on the user's
// wall clock once the bill is within their lead time, and one more if it goes
// overdue. Runs from the 30 minute timer in server.ts and from
// GET /api/cron/bill-reminders. Only users who turned reminders on
// (preferences.billReminders.enabled) are checked.

export const REMIND_FROM_HOUR = 9;

type NotificationType = "emi_due" | "credit_due" | "loan_due";
const TYPE_OF: Record<Bill["kind"], NotificationType> = {
  recurring: "emi_due",
  card: "credit_due",
  loan: "loan_due",
};

function wording(bill: Bill) {
  const amount = formatCurrency(bill.amount, bill.currency);
  const when =
    bill.status === "overdue"
      ? bill.daysUntil === -1
        ? "was due yesterday"
        : `was due ${-bill.daysUntil} days ago`
      : bill.daysUntil === 0
        ? "is due today"
        : bill.daysUntil === 1
          ? "is due tomorrow"
          : `is due in ${bill.daysUntil} days`;
  return {
    title: bill.status === "overdue" ? `Overdue: ${bill.title}` : `${bill.title} ${when}`,
    body: `${bill.title} (${amount}) ${when}.`,
  };
}

/** The stable key a reminder is sent under, so it is never sent twice. */
export function reminderKey(bill: Bill) {
  return `bill:${bill.id}:${bill.dueDate.slice(0, 10)}:${bill.status === "overdue" ? "overdue" : "soon"}`;
}

/** Sends the reminders due for one user. Returns how many were created. */
export async function sendBillRemindersForUser(userId: string, leadDays: number, timeZone: string, now = new Date()): Promise<number> {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  if (localHour(now, tz) < REMIND_FROM_HOUR) return 0;

  const bills = await listUpcomingBills(userId, { days: leadDays, now, timeZone: tz });
  let sent = 0;
  for (const bill of bills) {
    const key = reminderKey(bill);
    // Created before the push, so a retry after a crash cannot send it twice.
    const seen = await Notification.findOne({ user: userId, "meta.dedupKey": key }).select("_id").lean();
    if (seen) continue;
    const { title, body } = wording(bill);
    await Notification.create({
      user: userId,
      type: TYPE_OF[bill.kind],
      title,
      body,
      meta: { dedupKey: key, billId: bill.id, kind: "bill_reminder", dueDate: bill.dueDate },
    });
    void sendPushToUser(userId, { title, body, url: "/dashboard" }).catch((err) =>
      logger.error({ err }, "bill reminder push failed")
    );
    sent += 1;
  }
  return sent;
}

export async function sendBillReminders(now = new Date()): Promise<{ checked: number; sent: number }> {
  await connectDB();
  const users = await User.find({ "preferences.billReminders.enabled": true, isActive: { $ne: false } })
    .select("preferences.timezone preferences.billReminders")
    .lean<Array<{ _id: { toString(): string }; preferences?: { timezone?: string; billReminders?: { leadDays?: number } } }>>();
  let sent = 0;
  for (const u of users) {
    try {
      sent += await sendBillRemindersForUser(
        u._id.toString(),
        u.preferences?.billReminders?.leadDays ?? DEFAULT_BILL_REMINDER_SETTINGS.leadDays,
        u.preferences?.timezone ?? DEFAULT_TIME_ZONE,
        now
      );
    } catch (err) {
      logger.error({ err, userId: u._id.toString() }, "bill reminders failed for user");
    }
  }
  return { checked: users.length, sent };
}
