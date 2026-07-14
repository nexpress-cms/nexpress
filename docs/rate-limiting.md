# Rate limiting

NexPress applies per-IP API limits in the Next.js `proxy.ts` entrypoint. The
public server contract lives at `@nexpress/core/rate-limit`; the shared proxy
implementation and its injection factory live at `@nexpress/app/proxy`.

## Runtime modes

`NP_RATE_LIMIT_ADAPTER` has exactly two modes:

- `memory` (the default) uses one process-local `InMemoryRateLimiter`.
- `custom` requires a proxy-local, non-`memory` adapter. Use this for Redis or
  another shared store in a multi-node deployment.

The proxy is a separate runtime entrypoint from the application bootstrap. A
custom adapter installed only from `src/lib/init-core.ts` may therefore never
execute in the process that checks a request. Inject the adapter from
`src/proxy.ts` instead:

```dotenv
NP_RATE_LIMIT_ADAPTER=custom
NP_REDIS_URL=redis://redis.internal:6379
```

```ts
import { npCreateProxy } from "@nexpress/app/proxy";
import { RedisRateLimiter } from "@nexpress/rate-limiter-redis";

const rateLimiter = new RedisRateLimiter({ url: process.env.NP_REDIS_URL });

export const proxy = npCreateProxy({ rateLimiter });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Keep the generated thin `export { proxy } from "@nexpress/app/proxy"` wrapper
for the default memory mode. `npCreateProxy()` validates the adapter and the
environment intent immediately. The default proxy also rejects
`NP_RATE_LIMIT_ADAPTER=custom` if no adapter exists in its own runtime.

## Adapter contract

An adapter has one canonical lowercase `kind`, one `check()` function, and an
optional `shutdown()` function:

```ts
import type { NpRateLimitDecision, NpRateLimiterAdapter } from "@nexpress/core/rate-limit";

class SharedRateLimiter implements NpRateLimiterAdapter {
  readonly kind = "shared-store";

  async check(key: string, limit: number, windowMs: number): Promise<NpRateLimitDecision> {
    // Increment and test atomically in the shared store.
    return {
      limited: false,
      retryAfterSeconds: Math.ceil(windowMs / 1_000),
    };
  }

  async shutdown(): Promise<void> {
    // Close only connections owned by this adapter.
  }
}
```

Every dispatch validates these invariants before the proxy trusts a result:

- `key` is a non-empty opaque string of at most 2,048 characters.
- `limit` is a positive safe integer up to 1,000,000.
- `windowMs` is a positive safe integer up to 31 days.
- the result is the exact `{ limited, retryAfterSeconds }` object;
  `retryAfterSeconds` is a positive whole number no greater than the request
  window in seconds.
- successful `shutdown()` calls resolve to void.

Malformed inputs, adapter registrations, results, and runtime modes throw
`NpRateLimitContractError`. In particular, an adapter may no longer omit
`retryAfterSeconds`; this prevents a blocked response from emitting
`Retry-After: undefined`.

`npCheckRateLimit(request, adapter?)` is the canonical validated dispatcher.
The built-in memory and Redis adapters also validate direct `check()` calls so
calling the adapter without the dispatcher does not bypass the input contract.

## Registry and lifecycle

`setRateLimiter()` / `getRateLimiter()` remain available for server code that
shares one module runtime. The default proxy re-reads that registry on every
limited route, so replacing an adapter no longer leaves a stale cached
reference. For a Next.js custom proxy, direct `npCreateProxy()` injection is
the reliable path because it crosses the proxy entrypoint explicitly.

Call `await npShutdownRateLimiter()` to detach and close a registered adapter.
It is idempotent after the registry is empty and rejects a non-void shutdown
result. Shut down an owned registered adapter before replacing it. An adapter
passed directly to `npCreateProxy()` remains caller-owned; call its `shutdown()`
from an existing application shutdown coordinator or in tests. NexPress does
not install a second SIGINT/SIGTERM handler because the job worker owns the
framework process shutdown lifecycle.

`RedisRateLimiter.shutdown()` closes only clients it created. It is idempotent,
including concurrent calls, and is a no-op for a caller-supplied ioredis
client.

## Operations

Run `pnpm run doctor` before deploy. The stable `rate-limit.contract` check:

- rejects unknown `NP_RATE_LIMIT_ADAPTER` values without needing a database;
- reports whether the runtime intent is process-local memory or custom; and
- blocks production multi-node readiness when memory mode is combined with
  `NP_MULTI_NODE=true`, `NP_REPLICAS>1`, or an unsilenced managed-container
  hint.

Startup safety emits `multi_node_in_memory_rate_limiter` for the same unsafe
topology. Set `NP_MULTI_NODE=false` or `NP_REPLICAS=1` only when the deployment
is deliberately single-process.
