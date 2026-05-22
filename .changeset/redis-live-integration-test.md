---
"@nexpress/rate-limiter-redis": patch
---

Add an optional live Redis integration test for the fixed-window Lua script and
document the `TEST_REDIS_URL` workflow. The default unit test path still skips
the live checks unless a Redis URL is provided.
