---
"@nexpress/blocks": minor
"@nexpress/next": minor
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
"@nexpress/theme-docs": patch
---

Add a definition-aware block content contract that validates registered prop
schemas and container rules before Admin/app saves, previews, pattern
registration, and rendering. Plugin doctor now reports invalid pattern content
while preserving unknown plugin blocks and stale props as warnings. The
Magazine story items and Portfolio image-grid items now use their actual nested
array schemas. Docs API-table defaults now match its structured Admin schema.
