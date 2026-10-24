import { Types } from "mongoose";
import { z } from "zod";
import { subMonths } from "date-fns";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import SubscriptionDecision from "@/models/SubscriptionDecision";
import { detectSubscriptions, type DetectedSubscription } from "@/lib/subscription-detector";

// Subscriptions are detected on read from the user's expense history and
// merged with their confirm and dismiss decisions. Shared by the browser
// routes (/api/subscriptions) and the integration routes so both report the
// same list. See subscription-detector.ts for the rules.

export type SubscriptionStatus = "detected" | "confirmed" | "dismissed";

export const subscriptionStatusSchema = z.object({
  status: z.enum(["detected", "confirmed", "dismissed"]),
});

export class SubscriptionServiceError extends Error {
  constructor(public code: "SUBSCRIPTION_NOT_FOUND", message: string) {
    super(message);
  }
}

// How far back charges are read. Two years sees a yearly charge twice.
const LOOKBACK_MONTHS = 24;
const MAX_ROWS = 5000;

export interface SubscriptionItem extends Omit<DetectedSubscription, "key"> {
  status: SubscriptionStatus;
}

export interface SubscriptionList {
  subscriptions: SubscriptionItem[];
  totals: { count: number; monthly: number; yearly: number };
}

async function detectAll(userId: string) {
  await connectDB();
  const rows = await Transaction.find({
    user: new Types.ObjectId(userId),
    isDeleted: { $ne: true },
    type: "expense",
    // Series the user already tracks as recurring are shown on the recurring screens.
    isRecurring: { $ne: true },
    date: { $gte: subMonths(new Date(), LOOKBACK_MONTHS) },
  })
    .select("date amount description category account")
    .sort({ date: -1 })
    .limit(MAX_ROWS)
    .lean();

  return detectSubscriptions(
    rows.map((r) => ({
      date: r.date as Date,
      amount: r.amount as number,
      description: r.description as string | undefined,
      category: r.category as string,
      account: String(r.account),
    }))
  );
}

export interface ListSubscriptionsOptions {
  /** "detected" | "confirmed" | "dismissed" | "all". Default hides dismissed ones. */
  status?: string | null;
  /** Also return subscriptions whose next charge is long overdue. */
  includeLapsed?: boolean;
}

export async function listSubscriptions(userId: string, opts: ListSubscriptionsOptions = {}): Promise<SubscriptionList> {
  const detected = await detectAll(userId);
  const decisions = await SubscriptionDecision.find({ user: new Types.ObjectId(userId) }).select("key status").lean();
  const byKey = new Map(decisions.map((d) => [d.key as string, d.status as SubscriptionStatus]));

  const wanted = opts.status ?? "";
  const items: SubscriptionItem[] = detected
    .map(({ key, ...rest }) => ({ ...rest, status: byKey.get(key) ?? ("detected" as SubscriptionStatus) }))
    .filter((s) => (opts.includeLapsed ? true : s.active))
    .filter((s) => {
      if (wanted === "all") return true;
      if (wanted === "detected" || wanted === "confirmed" || wanted === "dismissed") return s.status === wanted;
      return s.status !== "dismissed";
    });

  const counted = items.filter((s) => s.status !== "dismissed" && s.active);
  return {
    subscriptions: items,
    totals: {
      count: counted.length,
      monthly: counted.reduce((sum, s) => sum + s.monthlyCost, 0),
      yearly: counted.reduce((sum, s) => sum + s.yearlyCost, 0),
    },
  };
}

/** Confirm, dismiss, or put a detection back to "detected" (the row stays, so realtime sees it). The id must belong to a current detection. */
export async function setSubscriptionStatus(userId: string, id: string, status: SubscriptionStatus): Promise<SubscriptionItem> {
  const detected = await detectAll(userId);
  const match = detected.find((s) => s.id === id);
  if (!match) throw new SubscriptionServiceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found");

  const user = new Types.ObjectId(userId);
  await SubscriptionDecision.updateOne(
    { user, key: match.key },
    { $set: { merchant: match.merchant, status } },
    { upsert: true }
  );
  const { key: _key, ...rest } = match;
  void _key;
  return { ...rest, status };
}
