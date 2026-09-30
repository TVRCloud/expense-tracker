import { TtlCache } from "@/lib/perf/ttl-cache";

// Result of the per-request "is this browser session still active?" check
// in the NextAuth jwt() callback, which used to cost a Session lookup on
// every API call (about eight per dashboard load). A sign-out-everywhere on
// this instance clears the user's entries at once; elsewhere it takes
// effect within the TTL.
const SESSION_TTL_MS = 30_000;
const sessions = new TtlCache<{ userId: string; active: boolean }>(SESSION_TTL_MS, 5000);

export function cachedSessionActive(jti: string): boolean | undefined {
  return sessions.get(jti)?.active;
}

export function rememberSession(jti: string, userId: string, active: boolean) {
  sessions.set(jti, { userId, active });
}

/** Call whenever a user's sessions are deactivated. */
export function forgetUserSessions(userId: string) {
  sessions.deleteWhere((v) => v.userId === userId);
}

/** Test hook. */
export function forgetAllSessionsForTests() {
  sessions.clear();
}
