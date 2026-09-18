import { getResourceQuotas } from "./config.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
  windowSeconds: number;
}

function memoryConsume(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: 0,
      limit,
      windowSeconds,
    };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit,
      windowSeconds,
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: 0,
    limit,
    windowSeconds,
  };
}

/**
 * Redis-backed when REDIS_URL is set; otherwise process-local sliding fixed window.
 */
export async function consumeRateLimit(
  key: string,
  opts?: { limit?: number; windowSeconds?: number },
): Promise<RateLimitResult> {
  const quotas = getResourceQuotas();
  const limit = opts?.limit ?? quotas.analyzeRateLimit;
  const windowSeconds = opts?.windowSeconds ?? quotas.analyzeRateWindowSeconds;
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return memoryConsume(key, limit, windowSeconds);
  }

  try {
    const { getRedisConnection } = await import("./redis.js");
    const redis = await getRedisConnection();
    if (!redis) return memoryConsume(key, limit, windowSeconds);

    const bucketKey = `ratelimit:${key}`;
    const count = await redis.incr(bucketKey);
    if (count === 1) {
      await redis.expire(bucketKey, windowSeconds);
    }
    const ttl = await redis.ttl(bucketKey);
    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, ttl > 0 ? ttl : windowSeconds),
        limit,
        windowSeconds,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: 0,
      limit,
      windowSeconds,
    };
  } catch {
    try {
      const { resetRedisConnection } = await import("./redis.js");
      resetRedisConnection();
    } catch {
      // ignore
    }
    return memoryConsume(key, limit, windowSeconds);
  }
}

export function clearRateLimitMemoryForTests(): void {
  memoryBuckets.clear();
}
