---
"@nexpress/core": patch
---

**Boot warning: in-memory rate limiter in multi-node deploys.**

`verifyStartupSafety` gains a new check `multi_node_in_memory_rate_limiter`
that fires when:

- `NP_MULTI_NODE=true` (or a container hint env var is set in
  production), AND
- the operator hasn't called `setRateLimiter()` to opt into a
  shared-store adapter

The default `InMemoryRateLimiter` keeps per-process buckets, so a
multi-replica deploy effectively multiplies the configured limit
by the replica count — a "5 login attempts / minute" rule
becomes "5 × N pods / minute" without any visible signal.

Operators get a one-line warning at boot pointing them at
`@nexpress/rate-limiter-redis` (or any custom adapter). Single-
node deploys silence the warning by setting `NP_MULTI_NODE=false`,
matching the existing `multi_node_local_storage` shape.

`NpStartupSafetyInput` gains an optional `rateLimiterCustom`
boolean — `false` means the default will be lazy-installed,
`true` means the operator opted in. `undefined` skips the check
(back-compat with older callers).

5 new tests pin: explicit-flag fire, container-hint fire,
custom-adapter silences, undefined skips, single-node skips.
