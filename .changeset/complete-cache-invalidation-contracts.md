---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
"create-nexpress": patch
---

Unify cache invalidation behind one exact, awaitable runtime contract. App
writes, collection and scheduled-publish workers, plugin cache APIs, Next path
and tag invalidation, CDN purge adapters, Admin Health, ops execution, and
cached theme/plugin fetch options now validate and report the same bounded
request and result shapes. Bootstrap may own an injected CDN adapter and closes
its optional lifecycle hook during terminal shutdown.
