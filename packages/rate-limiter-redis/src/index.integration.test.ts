import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";

import { RedisRateLimiter } from "./index.js";

const redisUrl = process.env.TEST_REDIS_URL;

function skipIfNoTestRedis(): boolean {
  return !redisUrl;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(skipIfNoTestRedis())("RedisRateLimiter (live Redis integration)", () => {
  let client: Redis | undefined;
  let prefixCounter = 0;

  beforeAll(async () => {
    client = new Redis(redisUrl!, {
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    await client.ping();
  });

  afterAll(async () => {
    await client?.quit();
  });

  function getClient(): Redis {
    if (!client) {
      throw new Error("Redis test client was not initialized");
    }
    return client;
  }

  function nextPrefix(): string {
    prefixCounter += 1;
    return `nexpress:test:rl:${process.pid}:${Date.now()}:${prefixCounter}:`;
  }

  it("stores the fixed window in Redis and limits across adapter instances", async () => {
    const redis = getClient();
    const keyPrefix = nextPrefix();
    const key = "ip-1:/api/auth/login";
    const first = new RedisRateLimiter({ client: redis, keyPrefix });
    const second = new RedisRateLimiter({ client: redis, keyPrefix });

    const firstDecision = await first.check(key, 1, 5_000);
    const secondDecision = await second.check(key, 1, 5_000);

    expect(firstDecision.limited).toBe(false);
    expect(secondDecision.limited).toBe(true);
    expect(secondDecision.retryAfterSeconds).toBeGreaterThan(0);
    await expect(redis.pttl(`${keyPrefix}${key}`)).resolves.toBeGreaterThan(0);
  });

  it("allows the same key again after the Redis TTL expires", async () => {
    const redis = getClient();
    const keyPrefix = nextPrefix();
    const key = "ip-2:/api/collections/posts";
    const limiter = new RedisRateLimiter({ client: redis, keyPrefix });

    await expect(limiter.check(key, 1, 100)).resolves.toMatchObject({ limited: false });
    await expect(limiter.check(key, 1, 100)).resolves.toMatchObject({ limited: true });

    await sleep(250);

    await expect(limiter.check(key, 1, 100)).resolves.toMatchObject({ limited: false });
  });

  it("keeps caller-supplied key prefixes isolated", async () => {
    const redis = getClient();
    const key = "ip-3:/api/admin/jobs/retry";
    const firstPrefix = nextPrefix();
    const secondPrefix = nextPrefix();
    const firstLimiter = new RedisRateLimiter({ client: redis, keyPrefix: firstPrefix });
    const secondLimiter = new RedisRateLimiter({ client: redis, keyPrefix: secondPrefix });

    await expect(firstLimiter.check(key, 1, 5_000)).resolves.toMatchObject({ limited: false });
    await expect(firstLimiter.check(key, 1, 5_000)).resolves.toMatchObject({ limited: true });
    await expect(secondLimiter.check(key, 1, 5_000)).resolves.toMatchObject({ limited: false });

    await expect(redis.exists(`${firstPrefix}${key}`, `${secondPrefix}${key}`)).resolves.toBe(2);
  });
});
