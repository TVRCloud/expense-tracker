import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { listSubscriptions } from "@/lib/subscription-service";

// GET /api/subscriptions — repeating charges found in the user's expenses.
// Filters: status=detected|confirmed|dismissed|all (default hides dismissed),
// includeLapsed=true. Same list as GET /api/integrations/subscriptions.
export async function GET(req: NextRequest) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const list = await listSubscriptions(user.id, {
      status: searchParams.get("status"),
      includeLapsed: searchParams.get("includeLapsed") === "true",
    });
    return NextResponse.json({ data: list });
  } catch (err) {
    logger.error({ err }, "GET /api/subscriptions failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
