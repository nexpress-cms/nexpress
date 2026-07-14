---
"@nexpress/core": patch
"@nexpress/app": patch
"@nexpress/next": patch
"@nexpress/rate-limiter-redis": patch
"create-nexpress": patch
---

Unify rate-limit runtime intent, adapter registration, requests, decisions,
proxy injection, Redis replies, shutdown, startup safety, and doctor diagnostics
behind one fail-closed contract.

Custom adapters must now expose a canonical lowercase `kind` and return the
required positive `retryAfterSeconds` field on every decision.
