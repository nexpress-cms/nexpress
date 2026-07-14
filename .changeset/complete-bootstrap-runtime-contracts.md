---
"@nexpress/app": patch
"@nexpress/auth-pages": patch
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/plugin-forum": patch
"@nexpress/theme-default": patch
"create-nexpress": patch
---

Unify process bootstrap behind the exact `read`, `plugins`, `worker`, and
`write` intents. Startup is race-safe, retryable, and fail-closed; terminal
shutdown drains every owned resource in dependency order. Framework-only raw
singleton wiring moves from the core root to `@nexpress/core/bootstrap`, while
apps, workers, standalone scripts, generated code, and scaffolds use the same
`createBootstrap()` contract.
