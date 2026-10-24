import { z } from "zod";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

// Per-user weekly review notification settings, stored on
// `preferences.weeklyReview`. Off until the user turns them on, so existing
// users and installed apps get no new notification until they opt in. `day` is
// the weekday the review arrives (0 Sunday to 6 Saturday, default Monday).

export const DEFAULT_WEEKLY_REVIEW_SETTINGS = { enabled: false, day: 1 } as const;

export type WeeklyReviewSettings = { enabled: boolean; day: number };

export const weeklyReviewSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    day: z.number().int().min(0).max(6).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.day !== undefined, { message: "Send enabled or day" });

export type WeeklyReviewSettingsUpdate = z.infer<typeof weeklyReviewSettingsSchema>;

type PrefsDoc = { preferences?: { weeklyReview?: Partial<WeeklyReviewSettings> } } | null;

function withDefaults(doc: PrefsDoc): WeeklyReviewSettings {
  const saved = doc?.preferences?.weeklyReview;
  return {
    enabled: saved?.enabled ?? DEFAULT_WEEKLY_REVIEW_SETTINGS.enabled,
    day: saved?.day ?? DEFAULT_WEEKLY_REVIEW_SETTINGS.day,
  };
}

export async function getWeeklyReviewSettings(userId: string): Promise<WeeklyReviewSettings> {
  await connectDB();
  const doc = await User.findById(userId).select("preferences.weeklyReview").lean<PrefsDoc>();
  return withDefaults(doc);
}

export async function updateWeeklyReviewSettings(userId: string, patch: WeeklyReviewSettingsUpdate) {
  await connectDB();
  const $set: Record<string, unknown> = {};
  if (patch.enabled !== undefined) $set["preferences.weeklyReview.enabled"] = patch.enabled;
  if (patch.day !== undefined) $set["preferences.weeklyReview.day"] = patch.day;
  const doc = await User.findByIdAndUpdate(userId, { $set }, { new: true })
    .select("preferences.weeklyReview")
    .lean<PrefsDoc>();
  return withDefaults(doc);
}
