import { z } from "zod";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

// Per-user bill reminder settings, stored on `preferences.billReminders`.
// Off until the user turns them on, so installed apps and existing users see
// no new notifications until they opt in.

export const DEFAULT_BILL_REMINDER_SETTINGS = { enabled: false, leadDays: 3 } as const;
export const MAX_LEAD_DAYS = 14;

export type BillReminderSettings = { enabled: boolean; leadDays: number };

export const billReminderSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    leadDays: z.number().int().min(1).max(MAX_LEAD_DAYS).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.leadDays !== undefined, { message: "Send enabled or leadDays" });

export type BillReminderSettingsUpdate = z.infer<typeof billReminderSettingsSchema>;

type PrefsDoc = { preferences?: { billReminders?: Partial<BillReminderSettings> } } | null;

function withDefaults(doc: PrefsDoc): BillReminderSettings {
  const saved = doc?.preferences?.billReminders;
  return {
    enabled: saved?.enabled ?? DEFAULT_BILL_REMINDER_SETTINGS.enabled,
    leadDays: saved?.leadDays ?? DEFAULT_BILL_REMINDER_SETTINGS.leadDays,
  };
}

export async function getBillReminderSettings(userId: string): Promise<BillReminderSettings> {
  await connectDB();
  const doc = await User.findById(userId).select("preferences.billReminders").lean<PrefsDoc>();
  return withDefaults(doc);
}

export async function updateBillReminderSettings(userId: string, patch: BillReminderSettingsUpdate) {
  await connectDB();
  const $set: Record<string, unknown> = {};
  if (patch.enabled !== undefined) $set["preferences.billReminders.enabled"] = patch.enabled;
  if (patch.leadDays !== undefined) $set["preferences.billReminders.leadDays"] = patch.leadDays;
  const doc = await User.findByIdAndUpdate(userId, { $set }, { new: true })
    .select("preferences.billReminders")
    .lean<PrefsDoc>();
  return withDefaults(doc);
}

/** True when the user has turned bill reminders on. The older per-kind due
 *  pushes (EMI day-before, card payment due) stand down for them so a bill
 *  never reminds twice. */
export async function billRemindersOn(userId: string): Promise<boolean> {
  return (await getBillReminderSettings(userId)).enabled;
}
