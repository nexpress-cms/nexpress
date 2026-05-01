---
"@nexpress/core": minor
"@nexpress/next": patch
---

Phase 22.2 — surface known-unsafe configurations at boot via the
structured logger.

`@nexpress/core` adds `verifyStartupSafety(input)` (re-exported from
the package root) — a pure function that takes the resolved storage
adapter id, the auth secret, `NODE_ENV`, and the `NX_MULTI_NODE` flag,
and emits warnings through `getScopedLogger({ subsystem: "boot" })`
for the two operationally-bitten cases:

- `LocalStorageAdapter` running with `NX_MULTI_NODE=true` (or `=1`),
  which silently drops uploads as nodes diverge on the local
  `./uploads` dir.
- `NODE_ENV=production` with `NX_SECRET` unset or shorter than 32
  characters, which lets sessions be forged with a weak key.

`@nexpress/next` calls the helper once per process from
`createBootstrap()`'s `ensureServices`, so any app using the standard
bootstrap (apps/web, scaffolded sites) picks the warnings up
automatically. Operators with `setLogger(...)` already in place get
the warnings in their structured-log pipeline; others see them on
stdout via the default `consoleLogger`.

Returns the list of emitted warning ids so tests can assert on them;
nothing in production reads the return value.
