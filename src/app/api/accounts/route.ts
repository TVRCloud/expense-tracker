import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";

const creditMetaSchema = z.object({
  creditLimit: z.number().int().positive().optional(),
  billingCycleDay: z.number().int().min(1).max(31).optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  apr: z.number().min(0).max(100).optional(),
  network: z.enum(["visa", "mastercard", "amex", "rupay", "discover", "diners"]).optional(),
  lastFourDigits: z.string().length(4).regex(/^\d{4}$/).optional(),
  cardholderName: z.string().max(60).optional(),
  minPaymentPct: z.number().min(0).max(100).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["cash", "bank", "credit_card", "savings", "investment", "wallet"]),
  balance: z.number().int().default(0),
  currency: z.string().default("USD"),
  color: z.string().optional(),
  icon: z.string().optional(),
  creditMeta: creditMetaSchema.optional(),
});

export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    await connectDB();
    const accounts = await Account.find({ user: user.id, isArchived: false })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ data: accounts });
  } catch (err) {
    logger.error({ err }, "GET /api/accounts failed");
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
    const account = await Account.create({ ...parsed.data, user: user.id });

    logger.info({ userId: user.id, accountId: account._id.toString() }, "Account created");
    return NextResponse.json({ data: account }, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/accounts failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
