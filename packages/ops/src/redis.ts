type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  quit(): Promise<void>;
  ping(): Promise<string>;
  connect?: () => Promise<void>;
  disconnect?: () => void;
  status?: string;
};

let cached: RedisLike | null | undefined;

const REDIS_OPTS = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: true,
  // Fail commands immediately when Redis is down (do not hang request handlers).
  enableOfflineQueue: false,
  connectTimeout: 3_000,
  commandTimeout: 3_000,
  retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
};

export async function getRedisConnection(): Promise<RedisLike | null> {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL;
  if (!url) {
    cached = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("ioredis");
    const RedisCtor = mod.default ?? mod;
    const client = new RedisCtor(url, REDIS_OPTS) as RedisLike;
    if (typeof client.connect === "function") {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("redis connect timeout")), 3_500),
        ),
      ]);
    }
    cached = client;
    return cached;
  } catch {
    // Do not cache failure — allow reconnect after Redis returns.
    cached = undefined;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    try {
      await cached.quit();
    } catch {
      try {
        cached.disconnect?.();
      } catch {
        // ignore
      }
    }
  }
  cached = undefined;
}

/** Drop a dead connection so the next call can reconnect after outages. */
export function resetRedisConnection(): void {
  if (cached) {
    try {
      cached.disconnect?.();
    } catch {
      // ignore
    }
  }
  cached = undefined;
}

export async function redisPing(): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    if (!redis) return false;
    const result = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), 2_500),
      ),
    ]);
    return result === "PONG";
  } catch {
    resetRedisConnection();
    return false;
  }
}
