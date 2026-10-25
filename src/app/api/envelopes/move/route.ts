import { NextRequest } from "next/server";
import { envelopeMoveSchema, moveBetweenEnvelopes } from "@/lib/envelope-service";
import { browserEnvelopeWrite } from "@/lib/envelope-browser";

// POST /api/envelopes/move — { month, from, to, amount, allowOverdraw? }.
export async function POST(req: NextRequest) {
  return browserEnvelopeWrite(req, "POST /api/envelopes/move", envelopeMoveSchema, (input, user) => moveBetweenEnvelopes(user.id, input));
}
