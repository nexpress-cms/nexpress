---
"@nexpress/core": minor
---

Isolate current-site execution with AsyncLocalStorage and add payload-derived
site scoping to job handler registration. Content save/delete jobs now require
the originating `siteId`, and scheduled publishing runs hooks and follow-up
dispatch in each document's validated site context.
