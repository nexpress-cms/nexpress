---
"@nexpress/blocks": minor
"@nexpress/next": minor
"@nexpress/admin": patch
"@nexpress/app": patch
---

Add a definition-aware block content contract that validates registered prop
schemas and container rules before Admin/app saves, previews, pattern
registration, and rendering. Plugin doctor now reports invalid pattern content
while preserving unknown plugin blocks and stale props as warnings.
