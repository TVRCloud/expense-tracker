import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SmsReviewItem from "@/models/SmsReviewItem";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

type Params = Promise<{ id: string }>;

// Discards a queued item without creating anything from it — e.g. a
// personal/OTP message that matched no parser, or an EMI/card message for an
// account the user doesn't want tracked. Applying a queued item into a real
// Transaction/Repayment is a separate follow-up (needs a UI to pick the
// account/loan and edit the parsed amount first).
export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await params;
    await connectDB();
    const item = await SmsReviewItem.findOneAndUpdate(
      { _id: id, user: user.id, status: "pending" },
      { $set: { status: "discarded", resolvedAt: new Date() } },
      { new: true }
    );
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: item });
  } catch (err) {
    logger.error({ err }, "DELETE /api/sms-review/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
