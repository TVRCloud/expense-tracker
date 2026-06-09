import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Budget from "@/models/Budget";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { Types } from "mongoose";
import { appendLedgerBlock } from "@/lib/ledger";

const createSchema = z.object({
  category: z.string().min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  limitAmount: z.number().int().positive(),
  alertAt: z.number().min(1).max(100).default(80),
});

export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    await connectDB();
    const userObjectId = new Types.ObjectId(user.id);
    const budgets = await Budget.find({ user: user.id, month, year, isDeleted: { $ne: true } }).lean();

    // Enrich with spent amounts
    const enriched = await Promise.all(
      budgets.map(async (b) => {
        const spent = await Transaction.aggregate([
          {
            $match: {
              user: userObjectId,
              isDeleted: { $ne: true },
              category: b.category,
              type: "expense",
              date: {
                $gte: new Date(year, month - 1, 1),
                $lt: new Date(year, month, 1),
              },
              $nor: [{
                recurringId: { $exists: true },
                installmentStatus: { $nin: ["paid"] },
              }],
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        return { ...b, spent: spent[0]?.total ?? 0 };
      })
    );

    return NextResponse.json({ data: enriched });
  } catch (err) {
    logger.error({ err }, "GET /api/budgets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();

    const existing = await Budget.findOne({
      user: user.id,
      category: parsed.data.category,
      month: parsed.data.month,
      year: parsed.data.year,
    });
    if (existing && existing.isDeleted !== true) {
      return NextResponse.json({ error: "Budget already exists for this category and period" }, { status: 409 });
    }

    if (existing?.isDeleted === true) {
      const before = existing.toObject();
      existing.set({
        ...parsed.data,
        isDeleted: false,
        deletedAt: undefined,
        deletedBy: undefined,
      });
      await existing.save();
      await appendLedgerBlock({
        userId: user.id,
        scope: "budget",
        entityId: existing._id.toString(),
        action: "restore",
        before,
        after: existing,
        actor: user,
      });
      return NextResponse.json({ data: existing }, { status: 201 });
    }

    const budget = await Budget.create({ ...parsed.data, user: user.id });
    await appendLedgerBlock({
      userId: user.id,
      scope: "budget",
      entityId: budget._id.toString(),
      action: "create",
      after: budget,
      actor: user,
    });
    return NextResponse.json({ data: budget }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/budgets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
