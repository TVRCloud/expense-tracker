import { z } from "zod";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

// Per-user tax settings on `preferences.tax`: which categories count as
// deductible. Names are kept trimmed and lower-case and matched without regard
// to case, so "Health" and "health" are one category.

export const MAX_DEDUCTIBLE_CATEGORIES = 50;
export const MAX_CATEGORY_LENGTH = 40;

export const taxSettingsSchema = z
  .object({
    deductibleCategories: z
      .array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH))
      .max(MAX_DEDUCTIBLE_CATEGORIES),
  })
  .strict();

// Change the list by what moved, so two quick changes (or two devices) do not
// overwrite each other the way a whole-list PUT can.
export const taxSettingsDiffSchema = z
  .object({
    add: z.array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH)).max(MAX_DEDUCTIBLE_CATEGORIES).optional(),
    remove: z.array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH)).max(MAX_DEDUCTIBLE_CATEGORIES).optional(),
  })
  .strict()
  .refine((v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0, { message: "Send add or remove" });

export type TaxSettings = { deductibleCategories: string[] };

type PrefsDoc = { preferences?: { tax?: { deductibleCategories?: string[] } } } | null;

/** The one way a category name is compared, here and in tax-service (JS lower-casing, so "Éducation" matches "éducation"). */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

export function normaliseCategories(names: string[]): string[] {
  return [...new Set(names.map(categoryKey).filter(Boolean))].sort();
}

function fromDoc(doc: PrefsDoc): TaxSettings {
  return { deductibleCategories: normaliseCategories(doc?.preferences?.tax?.deductibleCategories ?? []) };
}

export async function getTaxSettings(userId: string): Promise<TaxSettings> {
  await connectDB();
  return fromDoc(await User.findById(userId).select("preferences.tax").lean<PrefsDoc>());
}

export async function updateTaxSettings(userId: string, input: z.infer<typeof taxSettingsSchema>): Promise<TaxSettings> {
  await connectDB();
  const doc = await User.findByIdAndUpdate(
    userId,
    { $set: { "preferences.tax.deductibleCategories": normaliseCategories(input.deductibleCategories) } },
    { new: true }
  )
    .select("preferences.tax")
    .lean<PrefsDoc>();
  return fromDoc(doc);
}

export const deductibleFlagSchema = z.object({ deductible: z.boolean().nullable() }).strict();

/** Adds and removes names in one atomic update. null when the result would pass the 50 name limit. */
export async function changeTaxCategories(
  userId: string,
  diff: z.infer<typeof taxSettingsDiffSchema>
): Promise<TaxSettings | null> {
  await connectDB();
  const field = "$preferences.tax.deductibleCategories";
  const add = normaliseCategories(diff.add ?? []);
  const remove = normaliseCategories(diff.remove ?? []);
  // Removing wins over adding the same name in one request.
  const next = {
    $setUnion: [
      { $setDifference: [{ $ifNull: [field, []] }, { $literal: remove }] },
      { $setDifference: [{ $literal: add }, { $literal: remove }] },
    ],
  };
  const doc = await User.findOneAndUpdate(
    { _id: userId, $expr: { $lte: [{ $size: next }, MAX_DEDUCTIBLE_CATEGORIES] } },
    [{ $set: { "preferences.tax.deductibleCategories": next } }],
    { new: true, updatePipeline: true }
  )
    .select("preferences.tax")
    .lean<PrefsDoc>();
  return doc ? fromDoc(doc) : null;
}
