import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { Types } from "mongoose";
import { checkEmiDueNotifications } from "@/lib/emi-notifications";

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();

    const { searchParams } = new URL(req.url);
    const upcoming = searchParams.get("upcoming");
    const accountId = searchParams.get("accountId");

    const userId = new Types.ObjectId(user.id);

    // Fire-and-forget EMI due notifications
    void checkEmiDueNotifications(user.id);

    // ?upcoming=N → return next N unpaid installments due within the next 7 days.
    if (upcoming) {
      const limit = Math.min(parseInt(upcoming, 10) || 5, 20);
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const endOfWindow = new Date(startOfToday);
      endOfWindow.setDate(endOfWindow.getDate() + 7);
      endOfWindow.setHours(23, 59, 59, 999);
      const matchQ: Record<string, unknown> = {
        user: userId,
        isDeleted: { $ne: true },
        isRecurring: true,
        installmentStatus: "upcoming",
        date: { $gte: startOfToday, $lte: endOfWindow },
      };
      if (accountId) matchQ.account = new Types.ObjectId(accountId);

      const docs = await Transaction.find(matchQ)
        .sort({ date: 1 })
        .limit(limit)
        .lean();
      return NextResponse.json({ data: docs });
    }

    // Default: aggregate series by recurringId
    const matchQ: Record<string, unknown> = {
      user: userId,
      isDeleted: { $ne: true },
      isRecurring: true,
      recurringId: { $exists: true },
    };
    if (accountId) matchQ.account = new Types.ObjectId(accountId);

    const series = await Transaction.aggregate([
      { $match: matchQ },
      { $sort: { installmentIndex: 1 } },
      {
        $group: {
          _id: "$recurringId",
          label: { $first: "$recurrenceLabel" },
          amount: { $first: "$amount" },
          type: { $first: "$type" },
          frequency: { $first: "$recurrenceFrequency" },
          interval: { $first: "$recurrenceInterval" },
          category: { $first: "$category" },
          accountId: { $first: { $toString: "$account" } },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
          paidCount: {
            $sum: { $cond: [{ $eq: ["$installmentStatus", "paid"] }, 1, 0] },
          },
          remainingCount: {
            $sum: { $cond: [{ $in: ["$installmentStatus", ["upcoming", "overdue"]] }, 1, 0] },
          },
          nextDue: {
            $min: {
              $cond: [
                { $in: ["$installmentStatus", ["upcoming", "overdue"]] },
                "$date",
                null,
              ],
            },
          },
          startDate: { $min: "$date" },
          description: { $first: "$description" },
        },
      },
      { $sort: { nextDue: 1 } },
    ]);

    return NextResponse.json({ data: series });
  } catch (err) {
    logger.error({ err }, "GET /api/transactions/recurring failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
