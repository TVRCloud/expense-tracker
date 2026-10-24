import { Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import { listUpcomingBills, getUserTimeZone } from "@/lib/bills";
import { listSubscriptions } from "@/lib/subscription-service";
import { merchantKey } from "@/lib/subscription-detector";
import {
  DEFAULT_FORECAST_DAYS,
  MAX_FORECAST_DAYS,
  SPEND_LOOKBACK_DAYS,
  buildForecast,
  clampDays,
  subscriptionOccurrences,
  type Forecast,
  type ForecastEvent,
} from "@/lib/forecast-math";

// Cash flow forecast: the expected balance of the money in hand (bank, cash,
// wallet and savings accounts) over the next few days, and the lowest point,
// so a shortfall shows early. Read by GET /api/integrations/forecast and
// GET /api/forecast. The maths is in buildForecast (pure, unit tested); the
// service gathers what is known and hands it over.
//
// What goes in, all in minor units (paise):
//   - the balance of the liquid accounts today;
//   - recurring payments and income not yet paid (installments);
//   - credit card statements and loans the user owes (the same list as /bills);
//   - subscriptions found in the expenses, repeated by their cadence;
//   - the typical daily spend of the last 30 days that those do not explain,
//     applied from tomorrow on (today's spending so far is in the balance).
// Money other people owe the user is NOT counted, so the forecast errs on the
// careful side.

export { DEFAULT_FORECAST_DAYS, MAX_FORECAST_DAYS, SPEND_LOOKBACK_DAYS };
const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_DAYS = 60;
const LIQUID_TYPES = ["cash", "bank", "savings", "wallet"];

export type ForecastInputs = {
  /** Number of accounts counted in the starting balance. */
  accounts: number;
  lookbackDays: number;
  /** Typical spend per day not explained by the items below. */
  dailyAverageSpend: number;
  recurringCount: number;
  billCount: number;
  subscriptionCount: number;
  assumptions: string[];
};

export type ForecastResult = Forecast & {
  generatedAt: string;
  timeZone: string;
  currency: string;
  inputs: ForecastInputs;
};

export async function getCashFlowForecast(
  userId: string,
  opts: { days?: number | null; now?: Date; timeZone?: string } = {}
): Promise<ForecastResult> {
  await connectDB();
  const now = opts.now ?? new Date();
  const days = clampDays(opts.days);
  const timeZone = opts.timeZone ?? (await getUserTimeZone(userId));
  const userObjectId = new Types.ObjectId(userId);

  const accounts = await Account.find({
    user: userObjectId,
    isDeleted: { $ne: true },
    isArchived: { $ne: true },
    type: { $in: LIQUID_TYPES },
  })
    .select("balance currency")
    .lean<Array<{ _id: Types.ObjectId; balance: number; currency?: string }>>();
  const liquidIds = accounts.map((a) => a._id);
  const liquidSet = new Set(liquidIds.map(String));
  const startingBalance = accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const currency = accounts[0]?.currency ?? "INR";

  const windowEnd = new Date(now.getTime() + (days + 1) * DAY_MS);
  const overdueFrom = new Date(now.getTime() - OVERDUE_WINDOW_DAYS * DAY_MS);
  const lookbackFrom = new Date(now.getTime() - SPEND_LOOKBACK_DAYS * DAY_MS);

  const [installments, bills, subs, recentSpend] = await Promise.all([
    liquidIds.length
      ? Transaction.find({
          user: userObjectId,
          isDeleted: { $ne: true },
          reviewStatus: { $ne: "voided" },
          isRecurring: true,
          installmentStatus: { $in: ["upcoming", "overdue"] },
          type: { $in: ["income", "expense"] },
          account: { $in: liquidIds },
          date: { $gte: overdueFrom, $lte: windowEnd },
        })
          .select("amount type date recurrenceLabel description category")
          .limit(500)
          .lean<Array<{ amount: number; type: string; date: Date; recurrenceLabel?: string; description?: string; category: string }>>()
      : Promise.resolve([]),
    listUpcomingBills(userId, { days, now, timeZone }),
    listSubscriptions(userId),
    liquidIds.length
      ? Transaction.find({
          user: userObjectId,
          isDeleted: { $ne: true },
          reviewStatus: { $ne: "voided" },
          // Spending, and a confirmed refund which comes off it (as in the weekly review).
          $or: [{ type: "expense" }, { type: "income", refundStatus: "confirmed" }],
          recurringId: { $exists: false },
          account: { $in: liquidIds },
          date: { $gte: lookbackFrom, $lte: now },
        })
          .select("amount description type")
          .limit(5000)
          .lean<Array<{ amount: number; description?: string; type: string }>>()
      : Promise.resolve([]),
  ]);

  const events: ForecastEvent[] = [];

  for (const t of installments) {
    events.push({
      date: new Date(t.date),
      amount: t.type === "income" ? t.amount : -t.amount,
      label: t.recurrenceLabel ?? t.description ?? t.category,
      kind: "recurring",
    });
  }

  // Cards and loans from the shared bills list; recurring payments are read above (income too).
  const dueBills = bills.filter((b) => b.kind === "card" || b.kind === "loan");
  for (const b of dueBills) {
    events.push({ date: new Date(b.dueDate), amount: -b.amount, label: b.title, kind: b.kind });
  }

  const activeSubs = subs.subscriptions.filter((s) => s.active && s.status !== "dismissed" && liquidSet.has(s.accountId));
  let subscriptionCount = 0;
  for (const s of activeSubs) {
    const dates = subscriptionOccurrences(s.nextDate, s.cadence, now, days, timeZone);
    if (dates.length) subscriptionCount += 1;
    for (const d of dates) events.push({ date: d, amount: -s.amount, label: s.merchant, kind: "subscription" });
  }

  // Everyday spending that the subscriptions above do not already explain.
  const subKeys = new Set(activeSubs.map((s) => merchantKey(s.merchant)));
  const variable = recentSpend.filter((t) => !subKeys.has(merchantKey(t.description))).reduce((sum, t) => sum + (t.type === "income" ? -t.amount : t.amount), 0);
  const dailyAverageSpend = Math.round(variable / SPEND_LOOKBACK_DAYS);

  const forecast = buildForecast({ startingBalance, now, days, timeZone, events, dailySpend: dailyAverageSpend });

  return {
    ...forecast,
    generatedAt: now.toISOString(),
    timeZone,
    currency,
    inputs: {
      accounts: accounts.length,
      lookbackDays: SPEND_LOOKBACK_DAYS,
      dailyAverageSpend,
      recurringCount: installments.length,
      billCount: dueBills.length,
      subscriptionCount,
      assumptions: [
        "Counts bank, cash, wallet and savings accounts; credit cards are paid when their statement is due.",
        "Unpaid recurring payments and income, card statements, loans you owe and subscriptions land on their due dates; anything overdue counts today.",
        `Everyday spending is the average of the last ${SPEND_LOOKBACK_DAYS} days, minus subscriptions and recurring payments, applied from tomorrow.`,
        "Money other people owe you is not counted.",
      ],
    },
  };
}
