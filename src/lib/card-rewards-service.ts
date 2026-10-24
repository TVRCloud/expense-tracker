import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import { getCurrentCycle, getPastCycles, type CardConfig, type CycleDates } from "@/lib/credit-card";
import { CreditCardServiceError } from "@/lib/credit-card-service";
import {
  computeRewards,
  normalizeRule,
  type RewardResult,
  type RewardRule,
  type RewardRuleInput,
  type RewardTxn,
} from "@/lib/card-rewards";

// Reward rules and the earned estimate for credit cards. Shared by the browser
// routes (/api/credit-cards/**) and the integration routes
// (/api/integrations/credit-cards/**).

const DEFAULT_CYCLES = 3;
const MAX_CYCLES = 12;

type CardDoc = {
  _id: Types.ObjectId;
  name: string;
  type: string;
  creditMeta?: {
    billingCycleDay?: number;
    paymentDueDay?: number;
    creditLimit?: number;
    minPaymentPct?: number;
    lastFourDigits?: string;
  };
  rewardRule?: unknown;
};

async function loadCard(userId: string, accountId: string): Promise<CardDoc> {
  if (!Types.ObjectId.isValid(accountId)) throw new CreditCardServiceError("ACCOUNT_NOT_FOUND", "Not found");
  await connectDB();
  const card = await Account.findOne({ _id: accountId, user: userId, isArchived: { $ne: true } }).lean<CardDoc>();
  if (!card) throw new CreditCardServiceError("ACCOUNT_NOT_FOUND", "Not found");
  if (card.type !== "credit_card") throw new CreditCardServiceError("NOT_A_CREDIT_CARD", "Not a credit card account");
  return card;
}

function cardConfig(card: CardDoc): CardConfig | null {
  const meta = card.creditMeta;
  if (!meta?.billingCycleDay || !meta?.paymentDueDay) return null;
  return {
    billingCycleDay: meta.billingCycleDay,
    paymentDueDay: meta.paymentDueDay,
    creditLimit: meta.creditLimit ?? 0,
    minPaymentPct: meta.minPaymentPct ?? 2,
  };
}

export async function getRewardRule(userId: string, accountId: string): Promise<RewardRule | null> {
  const card = await loadCard(userId, accountId);
  return normalizeRule(card.rewardRule);
}

/** Replaces the whole rule. */
export async function setRewardRule(userId: string, accountId: string, input: RewardRuleInput): Promise<RewardRule> {
  await loadCard(userId, accountId);
  const rule: RewardRule = {
    kind: input.kind,
    baseRate: input.baseRate,
    categoryRates: input.categoryRates ?? [],
    cap: input.cap ?? null,
    pointValue: input.kind === "points" ? (input.pointValue ?? null) : null,
  };
  await Account.updateOne({ _id: accountId, user: userId }, { $set: { rewardRule: rule } });
  return rule;
}

export async function clearRewardRule(userId: string, accountId: string): Promise<void> {
  await loadCard(userId, accountId);
  await Account.updateOne({ _id: accountId, user: userId }, { $unset: { rewardRule: "" } });
}

export type CycleRewards = RewardResult & {
  label: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  isCurrent: boolean;
};

async function rewardsForCycles(
  userId: string,
  accountId: string,
  rule: RewardRule,
  cycles: { cycle: CycleDates; isCurrent: boolean }[]
): Promise<CycleRewards[]> {
  if (cycles.length === 0) return [];
  const earliest = cycles.reduce((min, c) => (c.cycle.periodStart < min ? c.cycle.periodStart : min), cycles[0]!.cycle.periodStart);
  const latest = cycles.reduce((max, c) => (c.cycle.periodEnd > max ? c.cycle.periodEnd : max), cycles[0]!.cycle.periodEnd);
  const txns = await Transaction.find(
    {
      user: new Types.ObjectId(userId),
      account: new Types.ObjectId(accountId),
      isDeleted: { $ne: true },
      reviewStatus: { $ne: "voided" },
      type: { $in: ["expense", "income"] },
      date: { $gte: earliest, $lte: latest },
    },
    { type: 1, amount: 1, category: 1, refundStatus: 1, date: 1 }
  ).lean<(RewardTxn & { date: Date })[]>();

  return cycles.map(({ cycle, isCurrent }) => {
    const inCycle = txns.filter((t) => t.date >= cycle.periodStart && t.date <= cycle.periodEnd);
    return {
      ...computeRewards(rule, inCycle),
      label: cycle.label,
      periodStart: cycle.periodStart.toISOString(),
      periodEnd: cycle.periodEnd.toISOString(),
      dueDate: cycle.dueDate.toISOString(),
      isCurrent,
    };
  });
}

export type CardRewardsView = {
  accountId: string;
  name: string;
  lastFourDigits: string | null;
  rule: RewardRule | null;
  /** Why there is no estimate: "no_rule" or "billing_cycle_not_set"; null when there is one. */
  reason: "no_rule" | "billing_cycle_not_set" | null;
  cycles: CycleRewards[];
  /** Totals over the returned cycles, same units as the rule. */
  total: { earned: number; value: number } | null;
};

/** One card: its rule and the estimate for the current cycle plus earlier ones. */
export async function getCardRewards(userId: string, accountId: string, cycles = DEFAULT_CYCLES): Promise<CardRewardsView> {
  const card = await loadCard(userId, accountId);
  const rule = normalizeRule(card.rewardRule);
  const base = {
    accountId: String(card._id),
    name: card.name,
    lastFourDigits: card.creditMeta?.lastFourDigits ?? null,
    rule,
  };
  if (!rule) return { ...base, reason: "no_rule", cycles: [], total: null };
  const config = cardConfig(card);
  if (!config) return { ...base, reason: "billing_cycle_not_set", cycles: [], total: null };

  const count = Math.min(MAX_CYCLES, Math.max(1, Math.floor(cycles)));
  const now = new Date();
  const list = [
    { cycle: getCurrentCycle(config, now), isCurrent: true },
    ...getPastCycles(config, count - 1, now).map((cycle) => ({ cycle, isCurrent: false })),
  ];
  const result = await rewardsForCycles(userId, accountId, rule, list);
  return {
    ...base,
    reason: null,
    cycles: result,
    total: {
      earned: result.reduce((s, c) => s + c.earned, 0),
      value: result.reduce((s, c) => s + c.value, 0),
    },
  };
}

export type RewardsOverview = {
  cards: CardRewardsView[];
  /** Paise: what the current cycles of all cards with a rule are worth. */
  currentValue: number;
};

/** Every active card with its rule and the current cycle only. */
export async function getRewardsOverview(userId: string): Promise<RewardsOverview> {
  await connectDB();
  const cards = await Account.find({ user: userId, type: "credit_card", isArchived: { $ne: true } })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();
  const views = await Promise.all(cards.map((c) => getCardRewards(userId, String(c._id), 1)));
  return {
    cards: views,
    currentValue: views.reduce((s, v) => s + (v.cycles[0]?.value ?? 0), 0),
  };
}
