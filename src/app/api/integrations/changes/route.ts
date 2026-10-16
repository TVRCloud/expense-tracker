import { withIntegrationRoute } from "@/lib/integrations/handler";
import { integrationOk } from "@/lib/integrations/response";
import { parseSince, resourcesChangedSince } from "@/lib/realtime/changed-since";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/integrations/changes?since=<epoch ms> — polling fallback for the
// app (and catch-up after an SSE reconnect). Returns which resources have a
// doc updated after `since`. `now` is sampled BEFORE querying so a change
// landing mid-query is reported again next poll instead of being missed.
// Missing/invalid `since` returns changed: [] (the caller just wants `now`).
// Hard-deleted notifications can't be detected this way (no tombstone).
export const GET = withIntegrationRoute("changes", async ({ req, user, requestId }) => {
  const now = Date.now();
  const since = parseSince(new URL(req.url).searchParams.get("since"));
  const changed = since ? await resourcesChangedSince(user.id, since) : [];

  const res = integrationOk({ now, changed }, requestId);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
