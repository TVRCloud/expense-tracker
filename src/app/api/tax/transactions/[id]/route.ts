import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { deductibleFlagSchema } from "@/lib/tax-settings";
import { setTransactionDeductible } from "@/lib/tax-service";

type Params = Promise<{ id: string }>;

// PATCH /api/tax/transactions/:id — { deductible: true | false | null }.
// true or false overrides the category rule for this expense, null goes back to it.
export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { id } = await ctx.params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid transaction id" }, { status: 400 });
    const parsed = deductibleFlagSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send deductible as true, false or null" }, { status: 400 });
    const result = await setTransactionDeductible(user.id, id, parsed.data.deductible);
    if (!result) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    return NextResponse.json({ data: result });
  } catch (err) {
    logger.error({ err }, "PATCH /api/tax/transactions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
