---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/theme": patch
---

Unify page metadata, JSON-LD, sitemap/index entries, Atom entries, and theme
SEO callback results behind one exact, bounded runtime contract. Collection
URL resolvers and theme sitemap/feed/robots hooks now fail before malformed
values reach crawler responses or caches, while Theme and Next consume Core's
canonical types directly.
