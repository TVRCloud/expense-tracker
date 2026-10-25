import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import User from "@/models/User";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import Budget from "@/models/Budget";
import Goal from "@/models/Goal";
import Loan from "@/models/Loan";
import Repayment from "@/models/Repayment";
import Receipt from "@/models/Receipt";

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();

    const [profile, accounts, transactions, budgets, goals, loans, repayments, receipts] = await Promise.all([
      User.findById(user.id).select("-password -passwordResetToken -passwordResetExpires").lean(),
      Account.find({ user: user.id }).lean(),
      Transaction.find({ user: user.id, isDeleted: { $ne: true } }).lean(),
      Budget.find({ user: user.id, isDeleted: { $ne: true } }).lean(),
      Goal.find({ user: user.id, isDeleted: { $ne: true } }).lean(),
      Loan.find({ user: user.id, isDeleted: { $ne: true } }).lean(),
      Repayment.find({ user: user.id, isDeleted: { $ne: true } }).lean(),
      // Metadata only: the images are encrypted with the server key and are not exported.
      Receipt.find({ user: user.id }).select("transaction contentType size createdAt").sort({ createdAt: 1 }).lean<{ _id: { toString(): string }; transaction: { toString(): string }; contentType: string; size: number; createdAt: Date }[]>(),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile,
      accounts,
      transactions,
      budgets,
      goals,
      loans,
      repayments,
      receipts: receipts.map((r) => ({
        id: r._id.toString(),
        transactionId: r.transaction.toString(),
        contentType: r.contentType,
        size: r.size,
        createdAt: r.createdAt,
      })),
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="expense-tracker-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /api/me/export failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
