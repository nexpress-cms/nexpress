---
"@nexpress/app": patch
"create-nexpress": patch
---

Harden release apply execution. Release apply now validates plan artifacts
against a NexPress command allowlist before dry-run or execution, blocks
tampered commands and metadata even with approval, and documents the safer
artifact execution gate in generated ops docs.
