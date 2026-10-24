import connectDB from "@/lib/mongodb";
import SecurityRateLimit from "@/models/SecurityRateLimit";

type RateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
};

const CONTENTION_RETRY_SECONDS = 2;

function isDuplicateKey(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// Every step is one atomic update, so concurrent callers cannot all read the same
// count and slip past the limit: (1) count one inside a live window that still has
// room, (2) refuse if a live window is full, (3) restart an expired window, or
// (4) create the first one. A lost race at (3) or (4) goes round again.
export async function checkSecurityRateLimit({ key, limit, windowMs }: RateLimitInput) {
  await connectDB();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = new Date();

    const counted = await SecurityRateLimit.findOneAndUpdate(
      { key, expiresAt: { $gt: now }, count: { $lt: limit } },
      { $inc: { count: 1 } },
      { returnDocument: "after" }
    );
    if (counted) return { allowed: true, remaining: Math.max(limit - counted.count, 0) };

    const live = await SecurityRateLimit.findOne({ key, expiresAt: { $gt: now } });
    if (live) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((live.expiresAt.getTime() - Date.now()) / 1000)) };
    }

    const expiresAt = new Date(Date.now() + windowMs);
    const restarted = await SecurityRateLimit.findOneAndUpdate(
      { key, expiresAt: { $lte: now } },
      { $set: { count: 1, expiresAt } }
    );
    if (restarted) return { allowed: true, remaining: Math.max(limit - 1, 0) };

    try {
      await SecurityRateLimit.create({ key, count: 1, expiresAt });
      return { allowed: true, remaining: Math.max(limit - 1, 0) };
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  // Could not settle after several races. Fail closed, but only for a moment:
  // this is contention, not a used-up window, so do not tell people to wait the
  // whole window (an hour for some callers).
  return { allowed: false, retryAfterSeconds: CONTENTION_RETRY_SECONDS };
}
