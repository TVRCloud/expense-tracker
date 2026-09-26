import { randomBytes } from "crypto";
import { hashKey } from "@/lib/integrations/auth";

// Shared by the settings page (/api/me/api-keys) and scripts/api-keys.ts so
// both mint keys the same way.
//
// The "etk_" prefix makes a leaked key easy to spot in logs, pastes, or a
// secret scanner. The 32 random bytes after it are what give the key its
// strength; the prefix is just a label.
export const API_KEY_PREFIX = "etk_";

// Upper bound on live (not revoked, not expired) keys per user, so a stolen
// browser session can't quietly mint an unbounded number of them.
export const MAX_ACTIVE_API_KEYS = 10;

export const API_KEY_EXPIRY_DAYS = [7, 30, 90, 365] as const;

export function generateApiKey() {
  const rawKey = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  return { rawKey, keyHash: hashKey(rawKey), lastFour: rawKey.slice(-4) };
}

export function expiryFromDays(days: number | null): Date | null {
  return days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// Mongo filter for keys that can still authenticate right now.
export function activeKeyFilter(now = new Date()) {
  return {
    revoked: false,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  };
}
