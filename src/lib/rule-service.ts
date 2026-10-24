import { Types } from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/mongodb";
import Rule from "@/models/Rule";
import Account from "@/models/Account";

// Categorise rules: the same merchant lands in the same category with the same
// clean name every time. Used by the browser routes (/api/rules), the
// integration routes (/api/integrations/rules), createTransaction() (manual
// adds and captures) and the capture ingest path. Do not copy this logic into
// a route; extend it here.
//
// Matching:
//  - field "merchant": the merchant text (a capture's parsed merchant, or the
//    description of a manual add)
//  - field "upi": a UPI id (name@bank) found in the merchant, the message text
//    or the description
//  - field "text": the whole message text (or description plus note)
//  - op "contains" (default) or "equals", case-insensitive, trimmed
// Rules run in order of `priority` (lower first), then oldest first. The FIRST
// matching rule wins; later rules are ignored for that transaction.
//
// Rules never overwrite a value the user set: see ruleOverridesForTransaction.

export const MAX_RULES_PER_USER = 200;

export class RuleServiceError extends Error {
  code: "NOT_FOUND" | "ACCOUNT_NOT_FOUND" | "DUPLICATE" | "LIMIT" | "INVALID";
  constructor(code: RuleServiceError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "RuleServiceError";
  }
}

/** HTTP status for a service error; one mapping for the browser and integration routes. */
export function ruleErrorStatus(code: RuleServiceError["code"]) {
  if (code === "NOT_FOUND" || code === "ACCOUNT_NOT_FOUND") return 404;
  if (code === "INVALID") return 400;
  return 409;
}

const tagSchema = z.string().trim().min(1).max(40);

const ruleFields = {
  field: z.enum(["merchant", "upi", "text"]),
  op: z.enum(["contains", "equals"]).default("contains"),
  value: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(50).optional(),
  merchantName: z.string().trim().min(1).max(80).optional(),
  accountId: z.string().optional(),
  tags: z.array(tagSchema).max(10).default([]),
  priority: z.number().int().min(0).max(10000).default(100),
  isActive: z.boolean().default(true),
};

function needsAnAction(d: { category?: string; merchantName?: string; accountId?: string; tags?: string[] }) {
  return Boolean(d.category || d.merchantName || d.accountId || (d.tags && d.tags.length));
}

export const ruleCreateSchema = z
  .object(ruleFields)
  .superRefine((d, ctx) => {
    if (!needsAnAction(d)) {
      ctx.addIssue({ code: "custom", path: ["category"], message: "Set a category, a merchant name, an account or tags" });
    }
    if (d.accountId && !Types.ObjectId.isValid(d.accountId)) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Invalid account" });
    }
  });

export const ruleUpdateSchema = z
  .object({
    field: ruleFields.field.optional(),
    op: z.enum(["contains", "equals"]).optional(),
    value: ruleFields.value.optional(),
    // null clears the action
    category: z.string().trim().min(1).max(50).nullable().optional(),
    merchantName: z.string().trim().min(1).max(80).nullable().optional(),
    accountId: z.string().nullable().optional(),
    tags: z.array(tagSchema).max(10).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (Object.keys(d).length === 0) {
      ctx.addIssue({ code: "custom", path: [], message: "Nothing to update" });
    }
    if (d.accountId && !Types.ObjectId.isValid(d.accountId)) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Invalid account" });
    }
  });

export const ruleTestSchema = z
  .object({
    merchant: z.string().max(200).optional(),
    text: z.string().max(2000).optional(),
    upi: z.string().max(120).optional(),
  })
  .refine((d) => Boolean(d.merchant || d.text || d.upi), { message: "Give a merchant, a UPI id or message text" });

export type RuleCreateInput = z.infer<typeof ruleCreateSchema> & { userId: string };
export type RuleUpdateInput = z.infer<typeof ruleUpdateSchema> & { userId: string; ruleId: string };

type RuleDoc = {
  _id: Types.ObjectId;
  field: "merchant" | "upi" | "text";
  op: "contains" | "equals";
  value: string;
  valueKey: string;
  category?: string;
  merchantName?: string;
  account?: Types.ObjectId | null;
  tags?: string[];
  priority: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type RuleView = {
  id: string;
  field: RuleDoc["field"];
  op: RuleDoc["op"];
  value: string;
  category: string | null;
  merchantName: string | null;
  accountId: string | null;
  tags: string[];
  priority: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

const keyOf = (value: string) => value.trim().toLowerCase();

export function toRuleView(r: RuleDoc): RuleView {
  return {
    id: r._id.toString(),
    field: r.field,
    op: r.op ?? "contains",
    value: r.value,
    category: r.category ?? null,
    merchantName: r.merchantName ?? null,
    accountId: r.account ? r.account.toString() : null,
    tags: r.tags ?? [],
    priority: r.priority,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function isDuplicateKey(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

async function requireAccount(userId: string, accountId: string) {
  const account = await Account.findOne({ _id: accountId, user: userId, isArchived: { $ne: true } }).select("_id").lean();
  if (!account) throw new RuleServiceError("ACCOUNT_NOT_FOUND", "Account not found");
}

export async function listRules(userId: string): Promise<RuleView[]> {
  await connectDB();
  const rules = await Rule.find({ user: userId }).sort({ priority: 1, createdAt: 1 }).lean<RuleDoc[]>();
  return rules.map(toRuleView);
}

export async function createRule(input: RuleCreateInput): Promise<RuleView> {
  const { userId, accountId, value, ...rest } = input;
  await connectDB();
  if ((await Rule.countDocuments({ user: userId })) >= MAX_RULES_PER_USER) {
    throw new RuleServiceError("LIMIT", `You can have at most ${MAX_RULES_PER_USER} rules`);
  }
  if (accountId) await requireAccount(userId, accountId);
  try {
    const rule = await Rule.create({
      ...rest,
      value,
      valueKey: keyOf(value),
      user: userId,
      ...(accountId ? { account: accountId } : {}),
    });
    return toRuleView(rule.toObject() as RuleDoc);
  } catch (err) {
    if (isDuplicateKey(err)) throw new RuleServiceError("DUPLICATE", "A rule with the same match already exists");
    throw err;
  }
}

export async function updateRule(input: RuleUpdateInput): Promise<RuleView> {
  const { userId, ruleId, accountId, category, merchantName, value, ...rest } = input;
  await connectDB();
  const current = await Rule.findOne({ _id: ruleId, user: userId }).lean<RuleDoc>();
  if (!current) throw new RuleServiceError("NOT_FOUND", "Rule not found");
  if (accountId) await requireAccount(userId, accountId);

  const set: Record<string, unknown> = { ...rest };
  const unset: Record<string, ""> = {};
  if (value !== undefined) {
    set.value = value;
    set.valueKey = keyOf(value);
  }
  if (category !== undefined) (category === null ? (unset.category = "") : (set.category = category));
  if (merchantName !== undefined) (merchantName === null ? (unset.merchantName = "") : (set.merchantName = merchantName));
  if (accountId !== undefined) (accountId === null ? (unset.account = "") : (set.account = accountId));

  // The rule must still do something after this edit.
  const after = {
    category: category === undefined ? current.category : (category ?? undefined),
    merchantName: merchantName === undefined ? current.merchantName : (merchantName ?? undefined),
    accountId: accountId === undefined ? current.account?.toString() : (accountId ?? undefined),
    tags: rest.tags ?? current.tags ?? [],
  };
  if (!needsAnAction(after)) {
    throw new RuleServiceError("INVALID", "A rule needs a category, a merchant name, an account or tags");
  }

  try {
    const updated = await Rule.findOneAndUpdate(
      { _id: ruleId, user: userId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true }
    ).lean<RuleDoc>();
    if (!updated) throw new RuleServiceError("NOT_FOUND", "Rule not found");
    return toRuleView(updated);
  } catch (err) {
    if (isDuplicateKey(err)) throw new RuleServiceError("DUPLICATE", "A rule with the same match already exists");
    throw err;
  }
}

export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  await connectDB();
  const res = await Rule.deleteOne({ _id: ruleId, user: userId });
  if (res.deletedCount === 0) throw new RuleServiceError("NOT_FOUND", "Rule not found");
}

// ── Matching ───────────────────────────────────────────────────────────────

const UPI_ID = /[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,}/i;

export type RuleSubject = { merchant?: string; text?: string; upi?: string };

export function upiOf(subject: RuleSubject): string | undefined {
  if (subject.upi) return subject.upi.trim().toLowerCase();
  for (const s of [subject.merchant, subject.text]) {
    const hit = s ? UPI_ID.exec(s) : null;
    if (hit) return hit[0].toLowerCase();
  }
  return undefined;
}

export function ruleMatches(rule: Pick<RuleDoc, "field" | "op" | "valueKey">, subject: RuleSubject): boolean {
  const hay =
    rule.field === "merchant" ? subject.merchant : rule.field === "text" ? (subject.text ?? subject.merchant) : upiOf(subject);
  if (!hay) return false;
  const h = hay.trim().toLowerCase();
  return rule.op === "equals" ? h === rule.valueKey : h.includes(rule.valueKey);
}

export type RuleOutcome = {
  ruleId: string;
  category?: string;
  merchantName?: string;
  accountId?: string;
  tags: string[];
};

/** First active rule that matches, in priority order; null when none does. */
export async function findMatchingRule(userId: string, subject: RuleSubject): Promise<RuleOutcome | null> {
  await connectDB();
  const rules = await Rule.find({ user: userId, isActive: true }).sort({ priority: 1, createdAt: 1 }).lean<RuleDoc[]>();
  for (const rule of rules) {
    if (!ruleMatches(rule, subject)) continue;
    return {
      ruleId: rule._id.toString(),
      ...(rule.category ? { category: rule.category } : {}),
      ...(rule.merchantName ? { merchantName: rule.merchantName } : {}),
      ...(rule.account ? { accountId: rule.account.toString() } : {}),
      tags: rule.tags ?? [],
    };
  }
  return null;
}

/** What a rule would do to this text, with no writes (the "test a rule" call). */
export async function testRules(userId: string, subject: RuleSubject) {
  const outcome = await findMatchingRule(userId, subject);
  return { matched: Boolean(outcome), ...(outcome ? { rule: outcome } : {}) };
}

/**
 * The fields a rule may set on a new transaction. Rules never overwrite a
 * value the user set:
 *  - category: only while it is still the default bucket ("other") or empty
 *  - merchant name (description): only when it came from a bank message (the
 *    caller says so with `descriptionFromCapture`) or is empty
 *  - tags: added to the ones given, never removing any
 * Returns null when no rule matches or nothing would change.
 */
export async function ruleOverridesForTransaction(
  userId: string,
  input: {
    category?: string;
    description?: string;
    note?: string;
    tags: string[];
    text?: string;
    descriptionFromCapture?: boolean;
  }
): Promise<{ category?: string; description?: string; tags?: string[]; ruleId: string } | null> {
  await connectDB();
  const hasRules = await Rule.exists({ user: userId, isActive: true });
  if (!hasRules) return null;

  const outcome = await findMatchingRule(userId, {
    merchant: input.description,
    text: input.text ?? [input.description, input.note].filter(Boolean).join(" "),
  });
  if (!outcome) return null;

  const out: { category?: string; description?: string; tags?: string[]; ruleId: string } = { ruleId: outcome.ruleId };
  const categoryUnset = !input.category || input.category === "other";
  if (outcome.category && categoryUnset && outcome.category !== input.category) out.category = outcome.category;
  const descriptionUnset = !input.description || input.descriptionFromCapture;
  if (outcome.merchantName && descriptionUnset && outcome.merchantName !== input.description) {
    out.description = outcome.merchantName;
  }
  const newTags = outcome.tags.filter((t) => !input.tags.includes(t));
  if (newTags.length) out.tags = [...input.tags, ...newTags];
  return out.category || out.description || out.tags ? out : null;
}
