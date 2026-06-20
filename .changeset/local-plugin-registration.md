---
"@nexpress/cli": patch
---

Detect generated local plugin workspace packages during `nexpress plugin add`
and install them with `pnpm --workspace` instead of querying the npm registry.
