import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Account from "@/models/Account";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { AccountServiceError, accountUpdateSchema, archiveAccount, updateAccount } from "@/lib/account-service";

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
    const parsed = accountUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const account = await updateAccount({ ...parsed.data, userId: user.id, accountId: id, actor: user });
    return NextResponse.json({ data: account });
  } catch (err) {
    if (err instanceof AccountServiceError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "PATCH /api/accounts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await archiveAccount(user.id, id, user);
    return NextResponse.json({ data: { message: "Account archived" } });
  } catch (err) {
    if (err instanceof AccountServiceError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    logger.error({ err }, "DELETE /api/accounts/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
