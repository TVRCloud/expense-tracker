import type { Model } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Account from "@/models/Account";
import Budget from "@/models/Budget";
import Goal from "@/models/Goal";
import Loan from "@/models/Loan";
import Notification from "@/models/Notification";
import CapturedMessage from "@/models/CapturedMessage";
import { RESOURCE_NAMES, type RealtimeResource } from "@/lib/realtime/changes";

const MODELS: Record<RealtimeResource, Model<any>> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  transactions: Transaction,
  accounts: Account,
  budgets: Budget,
  goals: Goal,
  loans: Loan,
  notifications: Notification,
  captures: CapturedMessage,
};

/** Parses `?since=` (epoch ms). Anything missing/non-numeric/<=0 is null. */
export function parseSince(raw: string | null): Date | null {
  if (!raw || !/^\d{1,16}$/.test(raw)) return null;
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Index suggestion (not applied; schemas untouched): `exists` below filters
// { user, updatedAt > since } per collection. Most collections have no
// { user: 1, updatedAt: -1 } index, so it scans the user's `user`-prefixed
// index entries. If this gets slow on big collections add
//   Schema.index({ user: 1, updatedAt: -1 })
// to transactions (first), then the others.
export async function resourcesChangedSince(userId: string, since: Date): Promise<RealtimeResource[]> {
  await connectDB();
  const flags = await Promise.all(
    RESOURCE_NAMES.map(async (name) => {
      const hit = await MODELS[name].exists({ user: userId, updatedAt: { $gt: since } });
      return hit ? name : null;
    })
  );
  return flags.filter((n): n is RealtimeResource => n !== null);
}
