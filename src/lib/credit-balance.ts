import { Types } from "mongoose";
import Transaction from "@/models/Transaction";
import CreditStatement from "@/models/CreditStatement";
import { getCurrentCycle, getPastCycles, type CardConfig, type CycleDates } from "@/lib/credit-card";

export type PayableCycle = CycleDates & { remainingDue: number };

export type CardCycleBalances = {
  currentCycle: CycleDates;
  unbilledUsage: number;
  pastCycles: PayableCycle[];
};

type TxnLite = {
  type: string;
  amount: number;
  account: unknown;
  transferTo?: unknown;
  date: Date | string;
};

// Ports the exact $switch branch order used by the old per-cycle aggregation
// (transfer into this card -> +amount; income -> -amount; transfer where
// this card is the transferTo side -> 0; expense -> +amount; anything else
// -> 0), then floors the cycle's total at 0 — same as the old
// `Math.max(0, result[0]?.balance ?? 0)` per aggregate call.
function sumCycleBalance(txns: TxnLite[], cardId: string, periodStart: Date, periodEnd: Date): number {
  let balance = 0;
  for (const t of txns) {
    const d = t.date instanceof Date ? t.date : new Date(t.date);
    if (d < periodStart || d > periodEnd) continue;

    const isAccount = String(t.account) === cardId;
    const isTransferTo = t.transferTo != null && String(t.transferTo) === cardId;

    if (t.type === "transfer" && isAccount) {
      balance += t.amount;
    } else if (t.type === "income") {
      balance -= t.amount;
    } else if (t.type === "transfer" && isTransferTo) {
      balance += 0;
    } else if (t.type === "expense") {
      balance += t.amount;
    }
  }
  return Math.max(0, balance);
}

// Lower-level primitive: given an arbitrary list of [start,end] ranges for
// one card, fetches the transactions spanning all of them in a single
// query and returns each range's balance, in the same order. Used by
// getCardCycleBalances (fixed current + 12 past cycles) and by routes that
// need balances for an arbitrary/unbounded set of statement periods (e.g.
// an account older than 12 months with more than 12 statement records).
export async function computeCycleBalancesForRanges(
  userId: string,
  accountId: string,
  ranges: Array<{ periodStart: Date; periodEnd: Date }>
): Promise<number[]> {
  if (ranges.length === 0) return [];

  const cardObjectId = new Types.ObjectId(accountId);
  const earliestStart = ranges.reduce((min, r) => (r.periodStart < min ? r.periodStart : min), ranges[0]!.periodStart);
  const latestEnd = ranges.reduce((max, r) => (r.periodEnd > max ? r.periodEnd : max), ranges[0]!.periodEnd);

  const txns = await Transaction.find(
    {
      user: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
      $or: [{ account: cardObjectId }, { transferTo: cardObjectId }],
      date: { $gte: earliestStart, $lte: latestEnd },
    },
    { type: 1, amount: 1, account: 1, transferTo: 1, date: 1 }
  ).lean<TxnLite[]>();

  const cardId = String(cardObjectId);
  return ranges.map((r) => sumCycleBalance(txns, cardId, r.periodStart, r.periodEnd));
}

// Replaces the old "1 aggregate for the current cycle + 12 more aggregates,
// one per past cycle" pattern (duplicated across credit-cards/summary,
// credit-notifications, and credit-cards/[accountId]/statements) with a
// single indexed range query covering the current cycle and all 12 past
// cycles, then computes every cycle's balance in memory from that one
// result set.
export async function getCardCycleBalances(
  userId: string,
  accountId: string,
  config: CardConfig
): Promise<CardCycleBalances> {
  const cardObjectId = new Types.ObjectId(accountId);
  const currentCycle = getCurrentCycle(config);
  const pastCycles = getPastCycles(config, 12);

  // pastCycles is newest-first (see getPastCycles) — the oldest cycle's
  // periodStart is the last element. Span from there through the current
  // cycle's end so one range query covers everything.
  const earliestStart = pastCycles[pastCycles.length - 1]?.periodStart ?? currentCycle.periodStart;
  const latestEnd = currentCycle.periodEnd;

  const [txns, statementRecords] = await Promise.all([
    Transaction.find(
      {
        user: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
        $or: [{ account: cardObjectId }, { transferTo: cardObjectId }],
        date: { $gte: earliestStart, $lte: latestEnd },
      },
      { type: 1, amount: 1, account: 1, transferTo: 1, date: 1 }
    ).lean<TxnLite[]>(),
    CreditStatement.find({
      account: cardObjectId,
      user: userId,
      isDeleted: { $ne: true },
    }).lean(),
  ]);

  const cardId = String(cardObjectId);
  const unbilledUsage = sumCycleBalance(txns, cardId, currentCycle.periodStart, currentCycle.periodEnd);

  const pastCyclesWithDue: PayableCycle[] = pastCycles.map((cycle) => {
    const balance = sumCycleBalance(txns, cardId, cycle.periodStart, cycle.periodEnd);
    const record = statementRecords.find(
      (item) => new Date(item.periodStart).getTime() === cycle.periodStart.getTime()
    );
    const remainingDue = Math.max(0, balance - (record?.paidAmount ?? 0));
    return { ...cycle, remainingDue };
  });

  return { currentCycle, unbilledUsage, pastCycles: pastCyclesWithDue };
}
