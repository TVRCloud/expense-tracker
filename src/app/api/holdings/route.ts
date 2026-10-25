import { NextRequest } from "next/server";
import { holdingBrowserRoute } from "@/lib/holding-browser-http";
import { createHolding, holdingCreateSchema, listHoldings } from "@/lib/holding-service";

// GET /api/holdings — holdings with today's value, totals, per-kind breakdown and upcoming SIPs.
export async function GET() {
  return holdingBrowserRoute("GET /api/holdings", null, {}, ({ userId }) => listHoldings(userId));
}

// POST /api/holdings — add a holding.
export async function POST(req: NextRequest) {
  return holdingBrowserRoute("POST /api/holdings", req, { schema: holdingCreateSchema, status: 201 }, ({ userId, input }) => createHolding(userId, input));
}
