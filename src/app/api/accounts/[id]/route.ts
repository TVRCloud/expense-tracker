import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { z } from "zod";
import { appendLedgerBlock } from "@/lib/ledger";

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

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  isArchived: z.boolean().optional(),
  creditMeta: creditMetaSchema.optional(),
});

type Params = Promise<{ id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const account = await Account.findOne({ _id: id, user: user.id }).lean();
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ data: account });
  } catch (err) {
    logger.error({ err }, "GET /api/accounts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    await connectDB();
    const before = await Account.findOne({ _id: id, user: user.id }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const account = await Account.findOneAndUpdate(
      { _id: id, user: user.id },
      { $set: parsed.data },
      { new: true }
    ).lean();

    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "account",
      entityId: id,
      action: "update",
      before,
      after: account,
      actor: user,
    });
    return NextResponse.json({ data: account });
  } catch (err) {
    logger.error({ err }, "PATCH /api/accounts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const before = await Account.findOne({ _id: id, user: user.id, isArchived: false }).lean();
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const account = await Account.findOneAndUpdate(
      { _id: id, user: user.id, isArchived: false },
      { $set: { isArchived: true, deletedAt: new Date(), deletedBy: user.id } },
      { new: true }
    ).lean();

    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await appendLedgerBlock({
      userId: user.id,
      scope: "account",
      entityId: id,
      action: "delete",
      before,
      after: account,
      actor: user,
    });
    return NextResponse.json({ data: { message: "Account archived" } });
  } catch (err) {
    logger.error({ err }, "DELETE /api/accounts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
