---
"create-nexpress": patch
---

Scaffold's `nexpress.config.ts` only registered `posts` and `pages` even with `--example` mode. `apps/web` carries four collections (categories, pages, posts, tags) and the `seedAll` helper assumes all four exist — so `pnpm setup` with "Include sample content" checked threw

```
Sample content seeding failed: Document not found: collection/tags
```

and bailed out before any sample posts/pages/categories/tags landed. Emit all four collection files from `getProjectFiles` and register them in `defineConfig({ collections })`.

`tags.ts` and `categories.ts` mirror the apps/web sources byte-for-byte; PR #704's thin-wrapper migration cleared these two off the scaffold side without noticing.
