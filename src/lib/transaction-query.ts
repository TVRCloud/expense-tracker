import { type PipelineStage, Types } from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { activityDateAddFields } from "@/lib/transaction-activity";

// Shared transaction-listing query logic, used by both GET /api/transactions
// (browser) and GET /api/integrations/transactions (n8n). Keeps one
// aggregation-pipeline implementation for the "hideFuture" mode instead of
// letting each caller reimplement (or simplify away) the pipeline.

export type ListTransactionsParams = {
  userId: string;
  skip: number;
  limit: number;
  type?: string | null;
  category?: string | null;
  accountId?: string | null;
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  hideFuture?: boolean;
  includeUnpaidRecurring?: boolean;
};

export function isValidObjectId(value: string | null | undefined) {
  return !value || Types.ObjectId.isValid(value);
}

export async function listTransactions(params: ListTransactionsParams) {
  const {
    userId,
    skip,
    limit,
    type,
    category,
    accountId,
    search,
    dateFrom,
    dateTo,
    hideFuture,
    includeUnpaidRecurring,
  } = params;

  const query: Record<string, unknown> = { user: userId, isDeleted: { $ne: true } };
  if (type) query.type = type;
  if (category) query.category = category;
  if (accountId) query.account = accountId;
  if (search) query.$text = { $search: search };
  if (dateFrom || dateTo) {
    query.date = {};
    if (dateFrom) (query.date as Record<string, unknown>).$gte = new Date(dateFrom);
    if (dateTo) (query.date as Record<string, unknown>).$lte = new Date(dateTo);
  }

  // Exclude unpaid recurring installments from the main list.
  // They live in /transactions/recurring/[id] instead.
  if (!includeUnpaidRecurring) {
    query.$nor = [
      {
        recurringId: { $exists: true },
        installmentStatus: { $nin: ["paid"] },
      },
    ];
  }

  await connectDB();

  if (hideFuture) {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const visibilityFilter = {
      $or: [
        {
          recurringId: { $exists: false },
          date: { $lte: endOfToday },
        },
        {
          recurringId: { $exists: true },
          installmentStatus: "paid",
          paidAt: { $exists: true, $lte: now },
        },
        {
          recurringId: { $exists: true },
          installmentStatus: "paid",
          paidAt: { $exists: false },
          date: { $lte: endOfToday },
        },
      ],
    };
    const aggregateQuery = {
      ...query,
      user: new Types.ObjectId(userId),
      ...(accountId ? { account: new Types.ObjectId(accountId) } : {}),
      $and: [...((query.$and as Record<string, unknown>[]) ?? []), visibilityFilter],
    };
    const pipeline: PipelineStage[] = [
      { $match: aggregateQuery },
      {
        $addFields: {
          ...activityDateAddFields(),
        },
      },
      {
        $facet: {
          data: [
            { $sort: { activityDate: -1, date: -1, _id: -1 } },
            { $skip: skip },
            { $limit: limit },
            { $project: { activityDate: 0 } },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];
    const [result] = await Transaction.aggregate(pipeline);
    return { data: result?.data ?? [], total: result?.total?.[0]?.count ?? 0, skip, limit };
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
    Transaction.countDocuments(query),
  ]);

  return { data: transactions, total, skip, limit };
}
