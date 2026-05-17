---
"@nexpress/next": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Extract the magazine + portfolio "list front" fetch into a shared `fetchFrontListPosts({ kind?, limit? })` helper on `@nexpress/next` (server-side helpers — `@nexpress/theme`'s ambient `@nexpress/core` declaration deliberately excludes `findDocuments`). Both themes now scope their home-page fetch by kind (`"article"` for magazine, `"project"` for portfolio), so multi-theme installs no longer surface cross-kind posts in the front layout. Theme behavior is unchanged on single-active-theme installs (today's common case).
