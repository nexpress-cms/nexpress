import { Redis, type RedisOptions } from "ioredis";

import {
  NpRateLimitContractError,
  npRequireRateLimitDecision,
  npRequireRateLimitRequest,
  type NpRateLimitDecision,
  type NpRateLimiterAdapter,
} from "@nexpress/core/rate-limit";

/**
 * Phase 23.7.1 — Redis-backed `NpRateLimiterAdapter`.
 *
 * Drop-in replacement for `InMemoryRateLimiter` in multi-node
 * deployments. The contract is identical (`check(key, limit,
 * windowMs)`), so wiring is one line at boot:
 *
 *   import { npCreateProxy } from "@nexpress/app/proxy";
 *   import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";
 *
 *   export const proxy = npCreateProxy({
 *     rateLimiter: new RedisRateLimiter({ url: process.env.NP_REDIS_URL }),
 *   });
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
const MAX_KEY_PREFIX_LENGTH = 256;
const MAX_REDIS_HOST_LENGTH = 253;
const MAX_REDIS_URL_LENGTH = 8_192;

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
  { client: Redis; keyPrefix?: string } | (RedisOptions & { url?: string; keyPrefix?: string });

function contractError(path: string, message: string): never {
  throw new NpRateLimitContractError("Invalid Redis rate-limiter contract", [
    { code: "invalid-field", path, message },
  ]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function requireKeyPrefix(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_KEY_PREFIX_LENGTH || value.includes("\0")) {
    contractError(
      "rateLimit.redis.keyPrefix",
      `must be a string no longer than ${MAX_KEY_PREFIX_LENGTH.toString()} characters without NUL bytes.`,
    );
  }
  return value;
}

function requireRedisUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REDIS_URL_LENGTH ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    contractError("rateLimit.redis.url", "must be a bounded absolute redis:// or rediss:// URL.");
  }
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") || !parsed.hostname) {
      contractError("rateLimit.redis.url", "must be a bounded absolute redis:// or rediss:// URL.");
    }
  } catch (error) {
    if (error instanceof NpRateLimitContractError) throw error;
    contractError("rateLimit.redis.url", "must be a bounded absolute redis:// or rediss:// URL.");
  }
  return value;
}

function requireRedisHost(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REDIS_HOST_LENGTH ||
    value !== value.trim() ||
    /\s/u.test(value) ||
    containsControlCharacter(value)
  ) {
    contractError(
      "rateLimit.redis.host",
      `must be a non-empty string no longer than ${MAX_REDIS_HOST_LENGTH.toString()} characters without whitespace or control characters.`,
    );
  }
  return value;
}

function requireClient(value: unknown): Redis {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { eval?: unknown }).eval !== "function" ||
    typeof (value as { quit?: unknown }).quit !== "function"
  ) {
    contractError(
      "rateLimit.redis.client",
      "must be an ioredis-compatible client with eval() and quit() functions.",
    );
  }
  return value as Redis;
}

function parseRedisInteger(value: unknown, path: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
    contractError(path, "must be a safe integer.");
  }
  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed.toString() === value) return parsed;
  }
  contractError(path, "must be a canonical safe integer or integer string.");
}

function requireScriptResult(value: unknown): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    contractError("rateLimit.redis.result", "must be an exact [count, ttlMs] tuple.");
  }
  const count = parseRedisInteger(value[0], "rateLimit.redis.result[0]");
  const ttlMs = parseRedisInteger(value[1], "rateLimit.redis.result[1]");
  if (count < 1) {
    contractError("rateLimit.redis.result[0]", "must be a positive request count.");
  }
  return [count, ttlMs];
}

export class RedisRateLimiter implements NpRateLimiterAdapter {
  readonly kind = "redis";

  private readonly client: Redis;
  private readonly ownsClient: boolean;
  private readonly keyPrefix: string;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: RedisRateLimiterOptions = {}) {
    if (!isPlainRecord(options)) {
      contractError("rateLimit.redis", "must be a plain options object.");
    }
    this.keyPrefix = requireKeyPrefix(options.keyPrefix ?? KEY_PREFIX);
    if ("client" in options) {
      for (const key of Object.keys(options)) {
        if (key !== "client" && key !== "keyPrefix") {
          contractError(
            `rateLimit.redis.${key}`,
            "is not supported when a caller-owned client is provided.",
          );
        }
      }
      // Caller passed an existing ioredis client (sharing it with
      // other Redis usage in the app). `shutdown()` is a no-op in
      // this mode so the caller keeps lifecycle ownership.
      this.client = requireClient(options.client);
      this.ownsClient = false;
      return;
    }
    const hasUrl = Object.prototype.hasOwnProperty.call(options, "url");
    const {
      keyPrefix: _kp,
      url,
      ...redisOpts
    } = options as RedisOptions & {
      keyPrefix?: string;
      url?: string;
    };
    void _kp;
    const redisUrl = hasUrl ? requireRedisUrl(url) : undefined;
    if (redisOpts.host !== undefined) requireRedisHost(redisOpts.host);
    if (
      redisOpts.port !== undefined &&
      (!Number.isSafeInteger(redisOpts.port) || redisOpts.port < 1 || redisOpts.port > 65_535)
    ) {
      contractError("rateLimit.redis.port", "must be an integer from 1 through 65535.");
    }
    if (redisOpts.db !== undefined && (!Number.isSafeInteger(redisOpts.db) || redisOpts.db < 0)) {
      contractError("rateLimit.redis.db", "must be a non-negative safe integer.");
    }
    this.client = redisUrl ? new Redis(redisUrl, redisOpts) : new Redis(redisOpts);
    this.ownsClient = true;
  }

  async check(key: string, limit: number, windowMs: number): Promise<NpRateLimitDecision> {
    const request = npRequireRateLimitRequest({ key, limit, windowMs });
    const fullKey = `${this.keyPrefix}${request.key}`;
    const rawResult: unknown = await this.client.eval(
      CHECK_SCRIPT,
      1,
      fullKey,
      request.windowMs.toString(),
    );
    const [count, ttlMs] = requireScriptResult(rawResult);
    const retryAfterSeconds =
      ttlMs > 0 ? Math.ceil(ttlMs / 1_000) : Math.ceil(request.windowMs / 1_000);
    return npRequireRateLimitDecision(
      { limited: count > request.limit, retryAfterSeconds },
      request,
    );
  }

  async shutdown(): Promise<void> {
    if (!this.ownsClient) return;
    this.shutdownPromise ??= this.client.quit().then(() => undefined);
    await this.shutdownPromise;
  }
}
