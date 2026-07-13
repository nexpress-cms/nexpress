---
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/admin": patch
"@nexpress/app": patch
---

Add a closed revision snapshot and API wire contract across persistence,
autosave, restore, Admin decoding, OpenAPI, and doctor diagnostics. Revision
versions remain monotonic after pruning, concurrent autosaves allocate versions
atomically, and document deletion removes its revision history.
