import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import Transaction from "@/models/Transaction";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { Types } from "mongoose";

type Params = Promise<{ id: string }>;

export async function POST(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();

    const account = await Account.findOne({ _id: id, user: user.id });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const accountObjectId = new Types.ObjectId(id);

    // Compute true balance from all transactions, counting only paid recurring installments.
    // Transfers affect both sides: source account decreases, destination account increases.
    const [agg] = await Transaction.aggregate([
      {
        $match: {
          user: new Types.ObjectId(user.id),
          $or: [
            { account: accountObjectId },
            { transferTo: accountObjectId },
          ],
          $nor: [{ recurringId: { $exists: true }, installmentStatus: { $nin: ["paid"] } }],
        },
      },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $eq: ["$type", "transfer"] },
                        { $eq: ["$account", accountObjectId] },
                        { $eq: ["$transferTo", accountObjectId] },
                      ],
                    },
                    then: 0,
                  },
                  {
                    case: {
                      $and: [
                        { $eq: ["$type", "transfer"] },
                        { $eq: ["$transferTo", accountObjectId] },
                      ],
                    },
                    then: "$amount",
                  },
                  { case: { $eq: ["$type", "income"] }, then: "$amount" },
                ],
                default: { $multiply: [-1, "$amount"] },
              },
            },
          },
        },
      },
    ]);

    const trueBalance = agg?.balance ?? 0;
    account.balance = trueBalance;
    await account.save();

    logger.info({ userId: user.id, accountId: id, trueBalance }, "Account balance recalculated");
    return NextResponse.json({ data: { balance: trueBalance } });
  } catch (err) {
    logger.error({ err }, "POST /api/accounts/[id]/recalculate failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
