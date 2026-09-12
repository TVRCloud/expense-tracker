import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import SmsReviewItem from "@/models/SmsReviewItem";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";

// Browser-facing read of the SMS review queue populated by
// POST /api/integrations/sms when a message couldn't be safely auto-applied.
// No confirm/apply action yet — that needs its own UI to let a person pick
// the right account/loan and edit the parsed amount before it's committed;
// for now this makes the queue visible/discardable.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "pending";

    await connectDB();
    const items = await SmsReviewItem.find({ user: user.id, status })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return NextResponse.json({ data: items });
  } catch (err) {
    logger.error({ err }, "GET /api/sms-review failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
