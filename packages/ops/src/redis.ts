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
};

let cached: RedisLike | null | undefined;

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
    const client = new RedisCtor(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    }) as RedisLike;
    if (typeof client.connect === "function") {
      await client.connect();
    }
    cached = client;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    try {
      await cached.quit();
    } catch {
      // ignore
    }
  }
  cached = undefined;
}

export async function redisPing(): Promise<boolean> {
  const redis = await getRedisConnection();
  if (!redis) return false;
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
