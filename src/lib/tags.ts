import { z } from "zod";

// User tags on a transaction. The server also writes its own tags
// (`loan:<id>`, `repayment:<id>`, `credit_statement:<id>`, `loan_principal`) to
// link rows to other records; those always contain a colon or are listed in
// RESERVED_TAGS, and a user can neither set nor remove them.

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;
const RESERVED_TAGS = new Set(["loan_principal"]);

export function isReservedTag(tag: string) {
  return tag.includes(":") || RESERVED_TAGS.has(tag);
}

/** One tag the way normaliseTags writes it (also used to match a filter). */
export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Trim, lowercase, collapse inner spaces, drop empties and repeats. */
export function normaliseTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normaliseTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

const tagText = z.string().max(MAX_TAG_LENGTH * 2);

// Rejects (rather than silently drops) a tag that is too long, reserved or too many,
// so the caller sees why. Case, spacing and repeats are cleaned up.
export const tagListSchema = z
  .array(tagText)
  .transform((tags) => normaliseTags(tags))
  .superRefine((tags, ctx) => {
    if (tags.length > MAX_TAGS) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_TAGS} tags` });
    }
    for (const tag of tags) {
      if (tag.length > MAX_TAG_LENGTH) {
        ctx.addIssue({ code: "custom", message: `A tag can be at most ${MAX_TAG_LENGTH} characters` });
        break;
      }
      if (tag.includes(";")) {
        ctx.addIssue({ code: "custom", message: "A tag cannot contain a semicolon" });
        break;
      }
      if (isReservedTag(tag)) {
        ctx.addIssue({ code: "custom", message: "A tag cannot contain a colon" });
        break;
      }
    }
  });

/** Tags from outside (a CSV file): cleaned, link tags dropped, at most MAX_TAGS. */
export function userTagsOnly(tags: readonly string[]): string[] {
  return normaliseTags(tags)
    .filter((t) => t.length <= MAX_TAG_LENGTH && !isReservedTag(t) && !t.includes(";"))
    .slice(0, MAX_TAGS);
}

/** A user's edit of the tags: their list plus every server tag already on the row. */
export function mergeUserTags(existing: readonly unknown[] | undefined, userTags: readonly string[]): string[] {
  const kept = (existing ?? []).filter((t): t is string => typeof t === "string" && isReservedTag(t));
  return [...userTags, ...kept];
}
