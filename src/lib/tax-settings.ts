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

export type TaxSettings = { deductibleCategories: string[] };

type PrefsDoc = { preferences?: { tax?: { deductibleCategories?: string[] } } } | null;

export function normaliseCategories(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort();
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
