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
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on("error", (err) => console.error("Redis error:", err.message));

  globalAny.redisGlobal = client;
  return client;
}

export const redis = getRedisClient();
