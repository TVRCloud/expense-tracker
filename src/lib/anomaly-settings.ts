import { z } from "zod";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { categoryKey, normaliseCategories } from "@/lib/tax-settings";

// Per-user anomaly alert settings on `preferences.anomalies`: a global switch
// (on until the person turns it off) and the categories they muted. Muted names
// are kept trimmed and lower-case and compared with `categoryKey`, so muting
// "dining" also mutes "Dining". The rules themselves read spending by the
// category exactly as it is stored (anomaly-service.ts), so "Dining" and
// "dining" are separate histories there.

export const MAX_MUTED_CATEGORIES = 50;
export const MAX_CATEGORY_LENGTH = 40;

const name = z.string().trim().min(1).max(MAX_CATEGORY_LENGTH);

export const anomalySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mutedCategories: z.array(name).max(MAX_MUTED_CATEGORIES).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.mutedCategories !== undefined, {
    message: "Send enabled or mutedCategories",
  });

// Change the muted list by what moved, so two quick changes do not overwrite each other.
export const anomalySettingsDiffSchema = z
  .object({
    enabled: z.boolean().optional(),
    add: z.array(name).max(MAX_MUTED_CATEGORIES).optional(),
    remove: z.array(name).max(MAX_MUTED_CATEGORIES).optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0, {
    message: "Send enabled, add or remove",
  });

export type AnomalySettings = { enabled: boolean; mutedCategories: string[] };

type PrefsDoc = {
  preferences?: { anomalies?: { enabled?: boolean; mutedCategories?: string[] } };
} | null;

export const DEFAULT_ANOMALY_SETTINGS: AnomalySettings = { enabled: true, mutedCategories: [] };

function fromDoc(doc: PrefsDoc): AnomalySettings {
  const saved = doc?.preferences?.anomalies;
  return {
    enabled: saved?.enabled ?? DEFAULT_ANOMALY_SETTINGS.enabled,
    mutedCategories: normaliseCategories(saved?.mutedCategories ?? []),
  };
}

export async function getAnomalySettings(userId: string): Promise<AnomalySettings> {
  await connectDB();
  return fromDoc(await User.findById(userId).select("preferences.anomalies").lean<PrefsDoc>());
}

/** Only the fields sent change. */
export async function updateAnomalySettings(
  userId: string,
  patch: z.infer<typeof anomalySettingsSchema>
): Promise<AnomalySettings> {
  await connectDB();
  const $set: Record<string, unknown> = {};
  if (patch.enabled !== undefined) $set["preferences.anomalies.enabled"] = patch.enabled;
  if (patch.mutedCategories !== undefined) {
    $set["preferences.anomalies.mutedCategories"] = normaliseCategories(patch.mutedCategories);
  }
  const doc = await User.findByIdAndUpdate(userId, { $set }, { new: true })
    .select("preferences.anomalies")
    .lean<PrefsDoc>();
  return fromDoc(doc);
}

/**
 * Switches the alerts and adds and removes muted names in one atomic update.
 * Removing wins over adding the same name in one request. null when the
 * result would pass the 50 name limit.
 */
export async function changeAnomalySettings(
  userId: string,
  diff: z.infer<typeof anomalySettingsDiffSchema>
): Promise<AnomalySettings | null> {
  await connectDB();
  const field = "$preferences.anomalies.mutedCategories";
  const add = normaliseCategories(diff.add ?? []);
  const remove = normaliseCategories(diff.remove ?? []);
  const next = {
    $setUnion: [
      { $setDifference: [{ $ifNull: [field, []] }, { $literal: remove }] },
      { $setDifference: [{ $literal: add }, { $literal: remove }] },
    ],
  };
  const set: Record<string, unknown> = { "preferences.anomalies.mutedCategories": next };
  if (diff.enabled !== undefined) set["preferences.anomalies.enabled"] = diff.enabled;
  const doc = await User.findOneAndUpdate(
    { _id: userId, $expr: { $lte: [{ $size: next }, MAX_MUTED_CATEGORIES] } },
    [{ $set: set }],
    { new: true, updatePipeline: true }
  )
    .select("preferences.anomalies")
    .lean<PrefsDoc>();
  return doc ? fromDoc(doc) : null;
}

/** True when the category is muted (compared with categoryKey, so "Dining" and "dining" are one). */
export function isMuted(settings: AnomalySettings, category: string): boolean {
  const key = categoryKey(category);
  return settings.mutedCategories.includes(key);
}
