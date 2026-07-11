---
"@nexpress/core": minor
---

Make `defineCollection()` a complete runtime contract boundary. Collection and
nested field definitions now reject unknown properties, duplicate or reserved
names, inconsistent bounds and inventories, stale slug/Admin references, and
invalid relationship or upload targets before codegen or application boot.
Complete collection-set validation also rejects duplicate slugs, missing
relationship targets, unsupported persistence shapes, and invalid theme-merged
definitions.
