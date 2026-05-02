# @nexpress/rate-limiter-redis

Redis-backed `NxRateLimiterAdapter` for multi-node
[NexPress](https://github.com/hahabsw/nexpress) deployments.

The default `InMemoryRateLimiter` shipped in `@nexpress/core` keeps
per-IP buckets in a process-local `Map`, which means the effective
limit on a 4-node cluster is `4 × configured`. Swap in this adapter
at boot to share the bucket across every instance.

## Install

```bash
pnpm add @nexpress/rate-limiter-redis
```

`ioredis` is bundled as a regular dependency — there's no peer
contract to satisfy.

## Usage

```ts
// apps/web/src/lib/init-core.ts (or your app's bootstrap)
import { setRateLimiter } from "@nexpress/core/rate-limit";
import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";

setRateLimiter(new RedisRateLimiter({ url: process.env.NX_REDIS_URL }));
```

Three constructor shapes:

```ts
// 1. Connection string (most common).
new RedisRateLimiter({ url: "redis://localhost:6379" });

// 2. ioredis options (host/port/password/cluster/etc.).
new RedisRateLimiter({ host: "redis.internal", port: 6379, db: 1 });

// 3. Reuse an existing ioredis client (e.g. shared with caching).
//    The adapter does NOT close the client on shutdown() in this
//    mode — the caller owns the lifecycle.
const client = new Redis(process.env.NX_REDIS_URL);
new RedisRateLimiter({ client });
```

Optional `keyPrefix` (defaults to `"nx:rl:"`) lets two NexPress
deploys share a Redis without colliding:

```ts
new RedisRateLimiter({ url, keyPrefix: "myapp:rl:" });
```

## How it works

A single Lua script issues `INCR` + `PTTL` + a conditional
`PEXPIRE` in one round trip per request. That gives:

- **Atomicity** — no race where two concurrent requests both see
  `count <= limit` because the increment happens server-side.
- **TTL safety** — a crash between INCR and EXPIRE in a naive
  two-step implementation would strand a key without a TTL. The
  Lua script sets the TTL inside the same call so the bucket
  always expires.
- **One round trip per check** — the proxy's hot path stays cheap.

Sliding-window or token-bucket semantics are out of scope for
v0.1; the adapter implements the same fixed-window contract as
`InMemoryRateLimiter` so behavior is identical to single-node
deploys.

## Shutdown

Call `await limiter.shutdown()` from your process's SIGTERM
handler if the adapter owns its client (cases 1 and 2 above). It's
a no-op when you passed in a shared client.

## License

MIT
