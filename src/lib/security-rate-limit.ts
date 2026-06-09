import connectDB from "@/lib/mongodb";
import SecurityRateLimit from "@/models/SecurityRateLimit";

type RateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
};

export async function checkSecurityRateLimit({ key, limit, windowMs }: RateLimitInput) {
  await connectDB();
  const now = new Date();
  const existing = await SecurityRateLimit.findOne({ key });

  if (!existing || existing.expiresAt <= now) {
    await SecurityRateLimit.findOneAndUpdate(
      { key },
      { $set: { count: 1, expiresAt: new Date(Date.now() + windowMs) } },
      { upsert: true }
    );
    return { allowed: true, remaining: Math.max(limit - 1, 0) };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.expiresAt.getTime() - Date.now()) / 1000) };
  }

  existing.count += 1;
  await existing.save();
  return { allowed: true, remaining: Math.max(limit - existing.count, 0) };
}
