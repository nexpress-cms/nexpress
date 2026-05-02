---
"@nexpress/rate-limiter-redis": minor
---

First-party Redis-backed `NxRateLimiterAdapter` (Phase 23.7.1).
Pairs with the adapter contract that landed in 23.7 to give
multi-node deploys a one-line swap-in:

```ts
import { setRateLimiter } from "@nexpress/core/rate-limit";
import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";

setRateLimiter(new RedisRateLimiter({ url: process.env.NX_REDIS_URL }));
```

Implementation issues a single Lua script per check (`INCR` +
`PTTL` + conditional `PEXPIRE`) so the bucket is incremented and
TTL-armed atomically — a crash between the increment and the
expiry in a naive two-step implementation could strand a TTL-less
key. One round trip per request keeps the proxy's hot path cheap.

Three constructor shapes: connection-string `url`, raw
`RedisOptions` (host/port/cluster/etc.), or a caller-supplied
ioredis client (shared with the app's other Redis usage —
`shutdown()` is a no-op in that mode so the consumer keeps
ownership of the lifecycle). Optional `keyPrefix` defaults to
`nx:rl:`.

Same fixed-window semantics as `InMemoryRateLimiter`, so behavior
is identical to single-node deploys; sliding-window / token-bucket
are out of scope for 0.1.
