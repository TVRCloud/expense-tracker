import Redis from "ioredis";
import { config } from "./config";

declare global {
  var redisGlobal: Redis | undefined;
}

const globalAny = global as typeof globalThis & { redisGlobal?: Redis };

function getRedisClient(): Redis | null {
  if (!config.redis.url) return null;
  if (globalAny.redisGlobal) return globalAny.redisGlobal;

  const client = new Redis(config.redis.url, {
    // 500ms was too tight for a real TLS handshake to a remote Redis
    // (Upstash) and made every connection attempt time out, silently
    // disabling the cache entirely (every command failed and every call
    // site treats that as "no cache", so this was invisible). Commands
    // themselves still fail fast via maxRetriesPerRequest below.
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on("error", (err) => console.error("Redis error:", err.message));

  // lazyConnect delays the actual TCP/TLS handshake until something calls
  // connect() — nothing else in the app does, and with enableOfflineQueue
  // false every command issued before that connect finishes throws instead
  // of queuing. Kick off the connection here (fire-and-forget) so the first
  // real cache read/write a request makes isn't the thing racing the
  // handshake. Every call site already treats redis as best-effort
  // (optional chaining + try/catch), so a failed connect here is fine — it
  // will retry per maxRetriesPerRequest on the next command.
  client.connect().catch((err) => console.error("Redis connect error:", err.message));

  globalAny.redisGlobal = client;
  return client;
}

export const redis = getRedisClient();
