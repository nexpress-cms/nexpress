import { Redis, type RedisOptions } from "ioredis";

import type { NxRateLimitDecision, NxRateLimiterAdapter } from "@nexpress/core/rate-limit";

/**
 * Phase 23.7.1 — Redis-backed `NxRateLimiterAdapter`.
 *
 * Drop-in replacement for `InMemoryRateLimiter` in multi-node
 * deployments. The contract is identical (`check(key, limit,
 * windowMs)`), so wiring is one line at boot:
 *
 *   import { setRateLimiter } from "@nexpress/core/rate-limit";
 *   import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";
 *
 *   setRateLimiter(new RedisRateLimiter({ url: process.env.NX_REDIS_URL }));
 *
 * Implementation: a single Lua script issues `INCR` + `PTTL` +
 * conditional `PEXPIRE` in one round trip, so an unlucky crash
 * between INCR and EXPIRE can't strand a key without a TTL.
 *
 * The script is kept inline rather than registered with `EVALSHA`
 * because the per-call payload is small (~200 bytes) and avoiding
 * the SCRIPT LOAD round trip on cold connections matters more than
 * the bandwidth saving on hot ones. ioredis caches script SHAs
 * automatically when `defineCommand` is used, but we keep the
 * helper version simple — no defineCommand, no shared lifecycle
 * with the consumer's other Redis usage.
 */

const KEY_PREFIX = "nx:rl:";

const CHECK_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export type RedisRateLimiterOptions =
  | { url: string; client?: never; keyPrefix?: string }
  | { url?: never; client: Redis; keyPrefix?: string }
  | (RedisOptions & { url?: never; client?: never; keyPrefix?: string });

export class RedisRateLimiter implements NxRateLimiterAdapter {
  private readonly client: Redis;
  private readonly ownsClient: boolean;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimiterOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? KEY_PREFIX;
    if ("client" in options && options.client) {
      // Caller passed an existing client (sharing it with other
      // Redis usage in the app). We don't disconnect it on
      // shutdown — the caller owns its lifecycle.
      this.client = options.client;
      this.ownsClient = false;
    } else if ("url" in options && options.url) {
      this.client = new Redis(options.url);
      this.ownsClient = true;
    } else {
      // Treat the rest of the options as RedisOptions (host/port/etc.).
      const { keyPrefix: _kp, ...redisOpts } = options as RedisOptions & {
        keyPrefix?: string;
      };
      void _kp;
      this.client = new Redis(redisOpts);
      this.ownsClient = true;
    }
  }

  async check(key: string, limit: number, windowMs: number): Promise<NxRateLimitDecision> {
    const fullKey = `${this.keyPrefix}${key}`;
    const result = (await this.client.eval(CHECK_SCRIPT, 1, fullKey, String(windowMs))) as [
      number | string,
      number | string,
    ];
    const count = typeof result[0] === "number" ? result[0] : Number.parseInt(result[0], 10);
    const ttlMs = typeof result[1] === "number" ? result[1] : Number.parseInt(result[1], 10);
    const retryAfterSeconds = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : Math.ceil(windowMs / 1000);
    if (count > limit) {
      return { limited: true, retryAfterSeconds };
    }
    return { limited: false, retryAfterSeconds };
  }

  async shutdown(): Promise<void> {
    if (this.ownsClient) {
      await this.client.quit();
    }
  }
}
