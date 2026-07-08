import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { Types } from "mongoose";
import { getDateAdder, OPEN_ENDED_WINDOW } from "@/lib/recurrence";
import { appendLedgerBlock } from "@/lib/ledger";
import { redis } from "@/lib/redis";
import logger from "@/lib/logger";

interface SeriesNeedingTopUp {
  _id: Types.ObjectId;
  remaining: number;
}

// Keeps open-ended recurring series (no end date/count — e.g. a recurring salary)
// topped up to OPEN_ENDED_WINDOW upcoming installments, instead of materializing
// years of future rows upfront. Run periodically (see server.ts).
export async function topUpRecurringSeries(): Promise<void> {
  try {
    await connectDB();

    const seriesNeedingTopUp = await Transaction.aggregate<SeriesNeedingTopUp>([
      {
        $match: {
          isRecurring: true,
          recurrenceIsOpenEnded: true,
          isDeleted: { $ne: true },
          recurrenceCancelled: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$recurringId",
          remaining: {
            $sum: { $cond: [{ $in: ["$installmentStatus", ["upcoming", "overdue"]] }, 1, 0] },
          },
        },
      },
      { $match: { remaining: { $lt: OPEN_ENDED_WINDOW } } },
    ]);

    if (!seriesNeedingTopUp.length) return;

    for (const series of seriesNeedingTopUp) {
      const need = OPEN_ENDED_WINDOW - series.remaining;
      if (need <= 0) continue;

      const last = await Transaction.findOne({
        recurringId: series._id,
        isDeleted: { $ne: true },
      })
        .sort({ installmentIndex: -1 })
        .lean();
      if (!last || last.installmentIndex == null) continue;

      const adder = getDateAdder(last.recurrenceFrequency ?? "monthly");
      const interval = last.recurrenceInterval ?? 1;
      const baseIndex = last.installmentIndex ?? 0;

      const newDocs = Array.from({ length: need }, (_, i) => ({
        user: last.user,
        account: last.account,
        type: last.type,
        amount: last.amount,
        currency: last.currency,
        category: last.category,
        subcategory: last.subcategory,
        description: last.description,
        note: last.note,
        tags: last.tags,
        transferTo: last.transferTo,
        isRecurring: true,
        recurringId: last.recurringId,
        recurrenceFrequency: last.recurrenceFrequency,
        recurrenceInterval: interval,
        recurrenceLabel: last.recurrenceLabel,
        recurrenceIsOpenEnded: true,
        date: adder(new Date(last.date), interval * (i + 1)),
        installmentIndex: baseIndex + i + 1,
        installmentStatus: "upcoming" as const,
      }));

      const inserted = await Transaction.insertMany(newDocs);
      for (const transaction of inserted) {
        await appendLedgerBlock({
          userId: String(last.user),
          scope: "transaction",
          entityId: transaction._id.toString(),
          action: "create",
          after: transaction,
        });
      }

      if (redis) {
        const keys = new Set<string>();
        for (const d of newDocs) {
          keys.add(`stats:v2:${String(last.user)}:${d.date.getFullYear()}:${d.date.getMonth() + 1}`);
        }
        await Promise.all([...keys].map(k => redis!.del(k))).catch(() => null);
      }

      logger.info(
        { recurringId: series._id.toString(), added: newDocs.length },
        "Topped up open-ended recurring series"
      );
    }
  } catch (err) {
    logger.error({ err }, "topUpRecurringSeries failed");
  }
}
