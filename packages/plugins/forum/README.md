# @nexpress/plugin-forum

Multi-board forum plugin for [NexPress](https://github.com/nexpress-cms/nexpress).
It combines native board/post collections, member writes, moderation, rich
text, daily-unique views, recommendations, bounded popular feeds, comments,
validated member attachments, and theme-neutral build-time skins.

## Install

```bash
pnpm add @nexpress/plugin-forum
```

Generated projects already receive `forumCollections` and `forumPlugin` through
the framework defaults. For a custom path, collection names, or skin catalog,
use one paired factory result:

```ts
import { defineConfig } from "@nexpress/core";
import { createForum } from "@nexpress/plugin-forum";

const forum = createForum({
  basePath: "/boards",
  defaultSkinId: "community-full",
});

export default defineConfig({
  collections: [...forum.collections],
  plugins: [forum.plugin],
});
```

Generate and apply the two collection tables, then create and publish a board
from Admin → Community → Forum boards:

```bash
pnpm db:generate && pnpm db:migrate
```

The default routes are `/boards`, `/boards/:boardKey`, member create/edit
routes, and UUID-based post detail URLs. A selected skin renders the board
index, post list, detail, and route-owned create/edit content without taking
over authentication or write policy. Members can write only board, title,
body, category, and attachment fields; pin, lock, status, board policy, and moderation stay
operator-owned. Board lists include bounded title/body search, category and
member filters, canonical filter-preserving pagination, and notices that stay
out of filtered results. List and detail surfaces share batched view, visible
comment, and reaction totals; the detail recommendation button uses the same
Core reaction contract as comments.

Published public posts expose a member-only report action. Reports use the
configured post collection slug, reject duplicate unresolved filings, surface
target context in Admin, and resolve through closed dismiss/unpublish actions.

Each board can enable attachments and set an exact file-count and per-file
size cap. Uploads reuse Core media storage, verify extension/MIME/signature,
remain uploader-only until referenced by a public published post, and are
served only as forced sandboxed downloads. Both bundled skins render the same
attachment count, detail list, and route-owned composer controls.

Two bundled skins are always available: `classic` for the familiar compact
table and `community-full` for policy summaries, author identity, status-rich
rows, numbered pagination, detailed post metadata, comments, and composers.
Both work with any theme. Forum structure ships in `@layer np-blocks` and reads
core theme tokens with documented `--np-forum-*` override properties, so a
theme can enhance the plugin without importing it and the plugin remains fully
usable without that theme.

Post detail routes localize the shared framework comment surface rather than
owning a parallel comment implementation. Each page receives batched public
author profiles and viewer reaction summaries and supports nested replies,
member-owned edit/delete, reporting, muting, sorting, and bounded pagination.
Skins and themes can enhance the stable `.np-comment-*` and
`data-np-comment-*` hooks independently.

The plugin also registers `forum.board-directory` and `forum.post-feed` blocks
plus a `forum.community-home` pattern. They use the forum factory's configured
paths and collection slugs internally, expose only published rows from active
boards, and give themes stable data/style hooks without making either package
depend on the other. The post feed supports latest, notices, and a 1–90 day
popular mode over at most 200 recent candidates.

See the full [forum guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-forum.md)
for board settings, skin authoring, policy behavior, and current scope.

## License

MIT
