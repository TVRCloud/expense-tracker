import { NextRequest } from "next/server";
import { holdingBrowserRoute } from "@/lib/holding-browser-http";
import { archiveHolding, getHolding, holdingUpdateSchema, updateHolding } from "@/lib/holding-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return holdingBrowserRoute("GET /api/holdings/[id]", null, { id: params }, ({ userId, id }) => getHolding(userId, id));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return holdingBrowserRoute("PATCH /api/holdings/[id]", req, { id: params, schema: holdingUpdateSchema }, ({ userId, id, input }) =>
    updateHolding(userId, id, input)
  );
}

// DELETE archives.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return holdingBrowserRoute("DELETE /api/holdings/[id]", null, { id: params }, ({ userId, id }) => archiveHolding(userId, id));
}
