import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { setSubscriptionStatus, subscriptionStatusSchema, SubscriptionServiceError } from "@/lib/subscription-service";

type Params = Promise<{ id: string }>;

// PATCH /api/subscriptions/[id] — { status: "confirmed" | "dismissed" | "detected" }.
export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const { id } = await ctx.params;
    const body = await req.json();
    const parsed = subscriptionStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await setSubscriptionStatus(user.id, id, parsed.data.status);
    return NextResponse.json({ data: updated });
  } catch (err) {
    if (err instanceof SubscriptionServiceError) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    logger.error({ err }, "PATCH /api/subscriptions/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
