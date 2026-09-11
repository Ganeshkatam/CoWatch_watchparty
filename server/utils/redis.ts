import config from "../config.ts";
import { Redis } from "ioredis";
import { getStartOfHour } from "./time.ts";
import { RedisMetrics } from "./redisMetrics.ts";

export { RedisMetrics };

// =====================================================================
// CoWatch Premium 3-Redis Architecture
// Strict 4-Tier Topology:
// 1. PostgreSQL (AUTHORITY) - Sole, absolute authority for auth, quota, lifecycle
// 2. Redis Core (COORDINATION) - Distributed coordination (locks, leases, idempotency, pub/sub)
// 3. Redis Edge (CACHE) - High-volume disposable cache (metadata, batched presence)
// 4. Redis Metrics (ANALYTICS) - Analytics telemetry, flushed in periodic batches
// 5. Local L1 Cache (MEMORY) - In-memory RAM, bounded LRU + TTL
// =====================================================================

// Bounded in-memory L1 Cache
interface L1Entry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedL1Cache {
  private cache = new Map<string, L1Entry<any>>();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  public get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Re-insert to maintain LRU access order
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlMs: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest item (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const l1Cache = new BoundedL1Cache(1000);

// Helper to create managed, resilient Redis connections
function createRedisClient(url: string | undefined, name: string): Redis | undefined {
  if (!url) return undefined;
  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.warn(`[REDIS ${name.toUpperCase()} ERROR]:`, err.message);
    });
    return client;
  } catch (err: any) {
    console.warn(`[REDIS ${name.toUpperCase()} INIT FAILED]:`, err.message);
    return undefined;
  }
}

// 3 Isolated Redis Instances (Separate URLs/Credentials, falling back to REDIS_URL)
const coreUrl = config.REDIS_CORE_URL || config.REDIS_URL;
const edgeUrl = config.REDIS_EDGE_URL || config.REDIS_URL;
const metricsUrl = config.REDIS_METRICS_URL || config.REDIS_URL;

const rawCoreClient = createRedisClient(coreUrl, "core");
const rawEdgeClient = createRedisClient(edgeUrl, "edge");
const rawMetricsClient = createRedisClient(metricsUrl, "metrics");

// Timed execution wrapper with instrumentation
async function executeTimed<T>(
  client: Redis | undefined,
  instance: 'core' | 'edge' | 'metrics',
  feature: string,
  op: string,
  action: (c: Redis) => Promise<T>
): Promise<T | undefined> {
  if (!client) return undefined;
  const start = Date.now();
  try {
    const res = await action(client);
    RedisMetrics.recordCommand(feature, op, Date.now() - start, true, instance);
    return res;
  } catch (err: any) {
    RedisMetrics.recordCommand(feature, op, Date.now() - start, false, instance);
    console.warn(`[REDIS ${instance.toUpperCase()} ${op.toUpperCase()} ERROR] (${feature}):`, err.message);
    return undefined;
  }
}

export async function waitForRedisReady(timeoutMs = 5000): Promise<boolean> {
  const clients = [rawCoreClient, rawEdgeClient, rawMetricsClient].filter(Boolean) as Redis[];
  if (clients.length === 0) return false;
  const readyPromises = clients.map((c) => {
    if (c.status === "ready") return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(c.status === "ready"), timeoutMs);
      c.once("ready", () => {
        clearTimeout(timer);
        resolve(true);
      });
      c.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  });
  const results = await Promise.all(readyPromises);
  return results.every(Boolean);
}

// =====================================================================
// Tier 1: redisCore (Coordination, Distributed Leases, Invalidation)
// Strict Rule: NEVER store playback state, auth decisions, or durable truth here.
// =====================================================================
export const redisCore = {
  isAvailable(): boolean {
    return Boolean(rawCoreClient && rawCoreClient.status !== "end" && rawCoreClient.status !== "close");
  },

  async setLease(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await executeTimed(rawCoreClient, "core", "lease", "set", (c) =>
      c.set(`core:lease:${key}`, value, "EX", ttlSeconds, "NX")
    );
    return res === "OK";
  },

  async getLease(key: string): Promise<string | null> {
    const res = await executeTimed(rawCoreClient, "core", "lease", "get", (c) =>
      c.get(`core:lease:${key}`)
    );
    return res ?? null;
  },

  async delLease(key: string): Promise<boolean> {
    const res = await executeTimed(rawCoreClient, "core", "lease", "del", (c) =>
      c.del(`core:lease:${key}`)
    );
    return Boolean(res && res > 0);
  },

  async publishInvalidation(channel: string, payload: string): Promise<number> {
    const res = await executeTimed(rawCoreClient, "core", "invalidation", "publish", (c) =>
      c.publish(`core:inv:${channel}`, payload)
    );
    return res || 0;
  },
};

// =====================================================================
// Tier 2: redisEdge / redisCache (High-Volume Disposable Cache, Batched Presence)
// Strict Rule: Safe to lose at any time. NEVER makes auth decisions.
// =====================================================================
export const redisEdge = {
  isAvailable(): boolean {
    return Boolean(rawEdgeClient && rawEdgeClient.status !== "end" && rawEdgeClient.status !== "close");
  },

  async get<T = string>(key: string): Promise<T | null> {
    const res = await executeTimed(rawEdgeClient, "edge", "cache", "get", (c) =>
      c.get(`edge:cache:${key}`)
    );
    if (!res) return null;
    try {
      return JSON.parse(res) as T;
    } catch {
      return res as unknown as T;
    }
  },

  async set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if (RedisMetrics.isDegradedMode()) {
      return false;
    }
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const res = await executeTimed(rawEdgeClient, "edge", "cache", "set", (c) =>
      c.set(`edge:cache:${key}`, serialized, "EX", ttlSeconds)
    );
    return res === "OK";
  },

  async del(key: string): Promise<boolean> {
    const res = await executeTimed(rawEdgeClient, "edge", "cache", "del", (c) =>
      c.del(`edge:cache:${key}`)
    );
    return Boolean(res && res > 0);
  },

  async getBuffer(key: string): Promise<Buffer | null> {
    const res = await executeTimed(rawCoreClient, "edge", "cache", "get", (c) =>
      c.getBuffer(`edge:cache:${key}`)
    );
    return res ?? null;
  },

  async setBuffer(key: string, buf: Buffer, ttlSeconds: number): Promise<boolean> {
    if (RedisMetrics.isDegradedMode()) {
      return false;
    }
    const res = await executeTimed(rawEdgeClient, "edge", "cache", "set", (c) =>
      c.set(`edge:cache:${key}`, buf, "EX", ttlSeconds)
    );
    return res === "OK";
  },

  // Presence batch operations (single Hash structure in Edge tier)
  async updateRoomPresenceBatch(updates: Record<string, string>): Promise<void> {
    if (Object.keys(updates).length === 0) return;
    await executeTimed(rawEdgeClient, "edge", "presence", "hset", (c) =>
      c.hset("edge:presence:rooms", updates)
    );
  },

  async removeRoomPresenceBatch(roomIds: string[]): Promise<void> {
    if (roomIds.length === 0) return;
    await executeTimed(rawEdgeClient, "edge", "presence", "hdel", (c) =>
      c.hdel("edge:presence:rooms", ...roomIds)
    );
  },

  async getRoomPresenceBatch(): Promise<Record<string, string>> {
    const res = await executeTimed(rawEdgeClient, "edge", "presence", "hgetall", (c) =>
      c.hgetall("edge:presence:rooms")
    );
    return res || {};
  },
};

// Backward-compatible alias for redisEdge
export const redisCache = redisEdge;

// =====================================================================
// Tier 3: redisMetrics / Analytics Buffer
// Buffers in local Node memory and flushes in periodic batches. NO per-event INCR.
// =====================================================================
class MetricsBatchBuffer {
  private countBuffer = new Map<string, number>();
  private distinctBuffer = new Map<string, Set<string>>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.flushTimer = setInterval(() => {
      this.flush().catch((e) => console.warn("[METRICS FLUSH FAILED]:", e.message));
    }, 10000); // 10s periodic batch flush
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  public recordCount(prefix: string, amount = 1): void {
    const key = `${prefix}:${getStartOfHour()}`;
    const current = this.countBuffer.get(key) || 0;
    this.countBuffer.set(key, current + amount);
  }

  public recordDistinct(prefix: string, item: string): void {
    const key = `${prefix}:${getStartOfHour()}`;
    let set = this.distinctBuffer.get(key);
    if (!set) {
      set = new Set();
      this.distinctBuffer.set(key, set);
    }
    set.add(item);
  }

  public async flush(): Promise<void> {
    if (!rawMetricsClient || (this.countBuffer.size === 0 && this.distinctBuffer.size === 0)) {
      return;
    }
    const counts = Array.from(this.countBuffer.entries());
    const distincts = Array.from(this.distinctBuffer.entries());
    this.countBuffer.clear();
    this.distinctBuffer.clear();

    const pipe = rawMetricsClient.pipeline();
    for (const [key, val] of counts) {
      pipe.incrby(key, val);
      pipe.expire(key, 86400);
    }
    for (const [key, items] of distincts) {
      pipe.pfadd(key, ...Array.from(items));
      pipe.expire(key, 86400);
    }
    await executeTimed(rawMetricsClient, "metrics", "analytics", "pipeline", async () => {
      await pipe.exec();
    });
  }
}

export const metricsBuffer = new MetricsBatchBuffer();

// redisMetrics service wrapper
export const redisMetricsClient = {
  isAvailable(): boolean {
    return Boolean(rawMetricsClient && rawMetricsClient.status !== "end" && rawMetricsClient.status !== "close");
  },

  async flush(): Promise<void> {
    await metricsBuffer.flush();
  },

  async getCountDay(prefix: string): Promise<number> {
    if (!rawMetricsClient) return 0;
    const keyArr: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      keyArr.push(`${prefix}:${getStartOfHour() - i * 3600 * 1000}`);
    }
    const values = await executeTimed(rawMetricsClient, "metrics", "analytics", "mget", (c) =>
      c.mget(...keyArr)
    );
    return (values || []).reduce((a: number, b: any) => (Number(a) || 0) + (Number(b) || 0), 0);
  },

  async getCountHour(prefix: string): Promise<number> {
    if (!rawMetricsClient) return 0;
    const value = await executeTimed(rawMetricsClient, "metrics", "analytics", "get", (c) =>
      c.get(`${prefix}:${getStartOfHour() - 3600 * 1000}`)
    );
    return Number(value) || 0;
  },

  async getCountDayDistinct(prefix: string): Promise<number> {
    if (!rawMetricsClient) return 0;
    const keyArr: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      keyArr.push(`${prefix}:${getStartOfHour() - i * 3600 * 1000}`);
    }
    const res = await executeTimed(rawMetricsClient, "metrics", "analytics", "pfcount", (c) =>
      c.pfcount(...keyArr)
    );
    return res || 0;
  },

  async getCountHourDistinct(prefix: string): Promise<number> {
    if (!rawMetricsClient) return 0;
    const res = await executeTimed(rawMetricsClient, "metrics", "analytics", "pfcount", (c) =>
      c.pfcount(`${prefix}:${getStartOfHour() - 3600 * 1000}`)
    );
    return res || 0;
  },
};

// Backward-compatible export functions for metrics
export async function redisCount(prefix: string) {
  metricsBuffer.recordCount(prefix, 1);
}

export async function redisCountDistinct(prefix: string, item: string) {
  metricsBuffer.recordDistinct(prefix, item);
}

export async function getRedisCountDay(prefix: string) {
  return redisMetricsClient.getCountDay(prefix);
}

export async function getRedisCountHour(prefix: string) {
  return redisMetricsClient.getCountHour(prefix);
}

export async function getRedisCountDayDistinct(prefix: string) {
  return redisMetricsClient.getCountDayDistinct(prefix);
}

export async function getRedisCountHourDistinct(prefix: string) {
  return redisMetricsClient.getCountHourDistinct(prefix);
}

// =====================================================================
// Request Flow: L1 (Memory) -> L2 (Redis Edge) -> PostgreSQL (Authority)
// =====================================================================
export async function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    l1TtlMs?: number;    // default 5 seconds
    l2TtlSec?: number;   // default 60 seconds
    feature?: string;   // feature tag for metrics
  } = {}
): Promise<T> {
  const { l1TtlMs = 5000, l2TtlSec = 60, feature = "cache" } = options;

  // 1. Check L1 Memory Cache (0 Redis commands, 0 DB queries)
  const l1Hit = l1Cache.get<T>(key);
  if (l1Hit !== undefined) {
    RedisMetrics.recordCacheHit(feature);
    return l1Hit;
  }
  RedisMetrics.recordCacheMiss(feature);

  // 2. Check L2 Redis Edge Cache (1 Redis command, 0 DB queries)
  if (redisEdge.isAvailable() && !RedisMetrics.isDegradedMode()) {
    try {
      const l2Hit = await redisEdge.get<T>(key);
      if (l2Hit !== null && l2Hit !== undefined) {
        l1Cache.set(key, l2Hit, l1TtlMs);
        RedisMetrics.recordCacheHit(feature);
        return l2Hit;
      }
    } catch (err: any) {
      // Failure Matrix: Cache fails -> transparently fall through to DB
      console.warn(`[CACHE DEGRADE] Falling back to DB for key ${key}:`, err.message);
    }
  }

  // 3. Query PostgreSQL (Authority)
  // Failure Matrix: DB fails -> REJECT (never fall back to Redis for durable truth)
  const dbData = await fetcher();

  // Populate L1 & L2 on successful fetch
  l1Cache.set(key, dbData, l1TtlMs);
  if (redisEdge.isAvailable() && !RedisMetrics.isDegradedMode()) {
    redisEdge.set(key, dbData, l2TtlSec).catch(() => {});
  }

  return dbData;
}

// Invalidation Orchestration: DB Commit -> Core Publish -> L1 Invalidate
export async function invalidateCacheKey(key: string): Promise<void> {
  // 1. Invalidate local L1
  l1Cache.invalidate(key);
  // 2. Invalidate L2 Edge
  if (redisEdge.isAvailable()) {
    await redisEdge.del(key);
  }
  // 3. Publish invalidation for other instances via Redis Core
  if (redisCore.isAvailable()) {
    await redisCore.publishInvalidation("cache_invalidation", key);
  }
}

// Atomic rate-limiting ops executed in CORE (without secondary EXPIRE round-trips)
const ATOMIC_INCR_EXPIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export async function atomicIncrWithTtl(key: string, ttlSeconds: number, feature = "ratelimit"): Promise<number> {
  const res = await executeTimed(rawCoreClient, "core", feature, "eval", (c) =>
    c.eval(ATOMIC_INCR_EXPIRE_LUA, 1, key, ttlSeconds)
  );
  return Number(res) || 1;
}

export async function getRateLimitCount(key: string, feature = "ratelimit"): Promise<number> {
  const res = await executeTimed(rawCoreClient, "core", feature, "get", (c) =>
    c.get(key)
  );
  return Number(res) || 0;
}

export async function getRateLimitTtl(key: string, feature = "ratelimit"): Promise<number> {
  const res = await executeTimed(rawCoreClient, "core", feature, "ttl", (c) =>
    c.ttl(key)
  );
  return Number(res) || -1;
}

export async function delRateLimit(key: string, feature = "ratelimit"): Promise<boolean> {
  const res = await executeTimed(rawCoreClient, "core", feature, "del", (c) =>
    c.del(key)
  );
  return Boolean(res && res > 0);
}

// Controlled export of the underlying client for legacy compatibility
export const redis = rawEdgeClient || rawCoreClient;
