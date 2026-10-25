import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import logger from "@/lib/logger";
import { envelopeSettingsSchema, getEnvelopeSettings, setEnvelopesEnabled } from "@/lib/envelope-service";
import { browserEnvelopeWrite } from "@/lib/envelope-browser";

// GET /api/envelopes/settings — { enabled }.
export async function GET() {
  try {
    const { user, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    return NextResponse.json({ data: await getEnvelopeSettings(user.id) });
  } catch (err) {
    logger.error({ err }, "GET /api/envelopes/settings failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/envelopes/settings — { enabled }: turn envelope mode on or off.
export async function PUT(req: NextRequest) {
  return browserEnvelopeWrite(req, "PUT /api/envelopes/settings", envelopeSettingsSchema, (input, user) => setEnvelopesEnabled(user.id, input.enabled));
}
