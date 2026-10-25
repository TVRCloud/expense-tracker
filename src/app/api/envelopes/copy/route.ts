import { NextRequest } from "next/server";
import { copyEnvelopePlan, envelopeCopySchema } from "@/lib/envelope-service";
import { browserEnvelopeWrite } from "@/lib/envelope-browser";

// POST /api/envelopes/copy — { month, from? }: copy another month's plan into an empty month.
export async function POST(req: NextRequest) {
  return browserEnvelopeWrite(req, "POST /api/envelopes/copy", envelopeCopySchema, (input, user) => copyEnvelopePlan(user.id, input));
}
