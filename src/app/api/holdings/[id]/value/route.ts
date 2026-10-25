import { NextRequest } from "next/server";
import { holdingBrowserRoute } from "@/lib/holding-browser-http";
import { holdingValueSchema, recordHoldingValue } from "@/lib/holding-service";

// POST /api/holdings/[id]/value — { value } (minor units) or { price } (decimal string) times the units held.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return holdingBrowserRoute("POST /api/holdings/[id]/value", req, { id: params, schema: holdingValueSchema }, ({ userId, id, input }) =>
    recordHoldingValue(userId, id, input)
  );
}
