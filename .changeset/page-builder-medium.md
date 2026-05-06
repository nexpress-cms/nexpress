---
"@nexpress/admin": patch
"@nexpress/blocks": patch
"@nexpress/plugin-sdk": patch
"@nexpress/next": patch
---

Page-builder medium tier (#467): plugin / theme contributed patterns flow through the bootstrap into the editor's command-menu pattern picker (`definePlugin({ patterns })` plus a shared pattern registry in `@nexpress/blocks`); favorites in the block palette pin a per-operator "Favorites" section above Recent (localStorage-persisted); a paste-import dialog in the command menu accepts a single block, an array of blocks, or a pattern object, validates, and inserts via `INSERT_PATTERN` so id-regeneration goes through the existing reducer.
