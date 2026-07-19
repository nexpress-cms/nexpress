# Forum plugin

`@nexpress/plugin-forum` provides a Korean-style multi-board community on top
of native NexPress collections, member writes, moderation, rich text, and
comments. It uses two collections:

- `forum-boards` stores operator-created boards and their policy.
- `forum-posts` stores posts for every board.

A board is a row, not a collection definition. Adding a 자유게시판, 공지사항, or
Q&A board therefore does not require code generation or a database migration.
The collection relationship keeps posts tied to a valid board.

## Default setup

Generated NexPress projects already include the paired `forumCollections` and
`forumPlugin` exports through `defaultCollections` and `defaultPlugins`.
After setup:

1. Open Admin → Community → Forum boards.
2. Create a board, choose a stable ASCII key such as `free`, and publish it.
3. Choose the skin, member-write mode, moderation mode, comment default, page
   size, and optional categories.
4. Visit `/boards`.

Board keys form `/boards/<boardKey>` URLs. Post detail URLs use the immutable
document UUID (`/boards/<boardKey>/<postId>`), so Korean titles never need to be
transliterated and title edits do not break links.

For an explicit or customized registration, create the plugin and collections
from the same factory call:

```ts
import { defineConfig } from "@nexpress/core";
import { createForum } from "@nexpress/plugin-forum";

const forum = createForum({
  basePath: "/community/boards",
  collections: {
    boards: "community-boards",
    posts: "community-posts",
  },
  defaultSkinId: "community-full",
});

export default defineConfig({
  collections: [...forum.collections],
  plugins: [forum.plugin],
});
```

Do not call `createForum()` separately for the collection and plugin arrays.
The factory intentionally closes route handlers, policy callbacks, Admin
actions, and relationship targets over one exact runtime definition.

## Board settings

| Setting                     | Behavior                                                               |
| --------------------------- | ---------------------------------------------------------------------- |
| Board key                   | Stable lowercase URL segment; 2–63 letters, digits, or hyphens         |
| Skin                        | Selects one build-time registered `NpForumSkin`                        |
| Who can create posts        | `members`, `staff`, or `closed`                                        |
| New member posts            | Publish immediately or enter the shared Admin pending queue            |
| Allow comments on new posts | Sets new posts to unlocked or locked; staff can change each post later |
| Posts per page              | Board-specific list size from 5 to 100                                 |
| Categories                  | Stable key plus display label pairs, scoped to the board               |

Staff manage `pinned`, `locked`, and status from the Forum posts collection.
Members can submit only `board`, `title`, `body`, and `category`. The core
member-write pipeline rejects any attempt to send operator fields before
moderation or persistence, checks the current board policy, prevents authors
from moving a post to another board, and derives `published` versus `pending`
from that board. A spam/profanity `flag` still forces `pending` even when the
board normally publishes immediately.

Deleting a board with posts is intentionally restricted by the relationship
foreign key. Move or delete its posts first so a stale post can never point to
a missing board.

## List discovery

Board lists support title/body full-text search, category filtering, the
authenticated member's own posts, and bounded pagination. The public query
contract recognizes only these values:

| Query      | Contract                                                       |
| ---------- | -------------------------------------------------------------- |
| `q`        | Trimmed and whitespace-normalized search text, up to 120 chars |
| `category` | One stable category key configured on the current board        |
| `author`   | The literal `me`, available only to an authenticated member    |
| `page`     | Canonical positive integer from 1 through 10,000               |

Recognized parameters that are duplicated, malformed, out of bounds, or refer
to another board's category fail closed. Unknown parameters such as campaign
tags are ignored. Search always combines the current board, visibility/status,
category, and member filters in one collection query. Pinned notices appear
only on the unfiltered public first page, so they cannot pollute filtered or
ranked results. Filter state is preserved by category, author, and pagination
links.

## Routes

| Route                            | Surface | Purpose                                 |
| -------------------------------- | ------- | --------------------------------------- |
| `/boards`                        | site    | Published board index                   |
| `/boards/:boardKey`              | site    | Searchable and filterable post list     |
| `/boards/:boardKey/new`          | member  | Authenticated member composer           |
| `/boards/:boardKey/:postId`      | site    | Post body, author actions, and comments |
| `/boards/:boardKey/:postId/edit` | member  | Owner-only edit form                    |

`surface: "member"` selects member chrome; the server route and collection
pipeline still perform the authentication and ownership checks.

## Bundled skins

Every forum registers two self-contained skins:

| ID               | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `classic`        | Familiar Korean board table with a compact detail and composer surface |
| `community-full` | Feature-rich cards, policy summaries, identity, state, and page chrome |

`classic` remains the default so an upgrade does not silently change an
existing board. Select `community-full` per board in Admin, or set
`defaultSkinId: "community-full"` for the `/boards` index and newly-created
boards. The full skin exposes notices, categories, search, member filtering,
numbered pagination, author avatars and display names, created/updated dates,
pin/lock/moderation state, comments, owner actions, and route-owned composers.
It does not fabricate counts or capabilities that the route contract does not
provide.

## Custom skins

Skins are build-time React render contracts. Runtime Admin settings select an
ID from the registered catalog; they never load arbitrary source from the
database.

```tsx
import { createForum, type NpForumSkin } from "@nexpress/plugin-forum";

const compactSkin: NpForumSkin = {
  id: "compact",
  label: "Compact",
  renderBoardIndex: (props) => <CompactBoardIndex {...props} />,
  renderPostList: (props) => <CompactPostList {...props} />,
  renderPostDetail: (props) => <CompactPostDetail {...props} />,
  renderPostComposer: (props) => <CompactPostComposer {...props} />,
};

export const forum = createForum({
  skins: [compactSkin],
  defaultSkinId: "compact",
});
```

The factory rejects malformed IDs, duplicate IDs (including collisions with
either bundled skin), incomplete render contracts, and an unregistered default
skin during module evaluation. The composer props contain route-owned form or
authentication content, so skins control the create/edit presentation without
duplicating member authentication, ownership, upload, or collection-write
policy. Projects that do not consume
`@nexpress/app/styles/globals.css` should import
`@nexpress/plugin-forum/styles.css` themselves.

Post-list skins receive the parsed `query`, `searchMaxLength`, and a
`hrefForQuery(patch)` helper. Use that helper for author, category, reset, and
pagination links so every skin preserves the same canonical query ordering and
omits default values. Filter patches reset pagination unless they explicitly
provide a page. The route owns parsing, board scoping, search execution, and
out-of-range rejection; a skin remains presentation-only.

## Home blocks and pattern

The forum contributes two server-rendered page-builder blocks. Both close over
the `basePath` and collection slugs passed to `createForum()`, so an editor
never has to expose an internal collection name in page content.

| Block type              | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `forum.board-directory` | Active board cards with descriptions, categories, and policies |
| `forum.post-feed`       | Bounded latest-discussion or pinned-notice feed                |

The directory supports 1–100 boards, automatic or fixed columns, and toggles
for descriptions, categories, and policy labels. The feed supports 1–20 rows,
list or card layout, optional board scoping, and board/category/author/date
visibility toggles. Leave `boardKey` empty to aggregate active boards; an
unknown key renders the empty state, while a value outside the board's exact
2–63 character key contract fails before a query.

`latest` excludes pinned notices so it composes without duplicates beside a
`notices` feed. Cross-board results retain only rows whose board relation and
immutable board-key snapshot agree with an active public board. Collection
reads remain site-scoped, anonymous visibility filtering remains active, and
only `published` posts reach either feed. Malformed, stale, private, draft, or
orphaned state therefore fails closed instead of leaking into a home page.

The `forum.community-home` pattern composes a board directory, notice list, and
latest-discussion cards. It references only forum-owned blocks and remains
available under every theme. The plugin does not expose a fake `popular` mode:
that requires a future bounded engagement metric rather than sorting by an
unrelated timestamp.

## Theme integration

The plugin and the active theme remain independent packages. Forum structural
CSS lives in `@layer np-blocks` with complete core-token fallbacks; it neither
imports a theme nor checks a theme ID. A theme can enhance the forum from its
own CSS without importing `@nexpress/plugin-forum` by setting these inherited
properties on its shell:

| Property                                | Controls                                 |
| --------------------------------------- | ---------------------------------------- |
| `--np-forum-content-max`                | Board index and list maximum width       |
| `--np-forum-detail-max`                 | Post detail maximum width                |
| `--np-forum-composer-max`               | Create/edit maximum width                |
| `--np-forum-page-gutter`                | Inline viewport gutter                   |
| `--np-forum-page-space`                 | Block margin around a forum route        |
| `--np-forum-panel-background`           | Full-skin cards and panels               |
| `--np-forum-panel-border`               | Full-skin panel and row borders          |
| `--np-forum-panel-radius`               | Full-skin panel radius                   |
| `--np-forum-panel-shadow`               | Board-card shadow                        |
| `--np-forum-muted-background`           | Secondary surfaces                       |
| `--np-forum-muted-foreground`           | Secondary text                           |
| `--np-forum-accent`                     | Active states, links, and policy markers |
| `--np-forum-accent-foreground`          | Text placed on the accent                |
| `--np-forum-row-min-height`             | Full-skin list density                   |
| `--np-forum-row-padding`                | Full-skin row padding                    |
| `--np-forum-block-space`                | Vertical spacing around forum blocks     |
| `--np-forum-block-gap`                  | Directory and feed-card gap              |
| `--np-forum-block-board-min-height`     | Directory card minimum height            |
| `--np-forum-block-card-padding`         | Directory card padding                   |
| `--np-forum-block-feed-card-min-height` | Feed-card minimum height                 |

The bundled `@nexpress/theme-community` demonstrates this boundary: it remains
usable without the forum and applies optional integration only when forum
markup is present:

```css
.np-community-shell {
  --np-forum-content-max: 80rem;
  --np-forum-panel-radius: 0.35rem;
  --np-forum-row-min-height: 5rem;
  --np-forum-accent: var(--np-color-primary);
}
```

Its home template also exposes `data-np-community-home-slot="extensions"`.
Operators can insert the plugin-owned `forum.community-home` pattern there,
but the theme never imports that pattern, assumes it exists, or queries the
forum's configurable collection slugs.

The plugin manifest also publishes stable selectors for the root, board index,
post list, discovery controls, notice list, normal post rows, post detail,
composer, comments, board-directory block, post-feed block, and feed items.
Every bundled skin marks its root with
`data-np-forum-skin` and one of the `data-np-forum-surface` values
`board-index`, `post-list`, `post-detail`, or `composer`. Themes should use
these documented hooks instead of depending on a skin's internal React tree.
Home blocks expose `data-np-forum-block="board-directory|post-feed"`, while the
feed adds `data-np-forum-feed-mode`, `data-np-forum-feed-layout`, and
`data-np-forum-board`.
Conversely, a theme must not query the forum's configurable collection slugs;
the plugin-owned blocks are the supported integration boundary.

## Current boundary

The foundation includes multi-board Admin configuration, classic and
community-full index/list/detail/composer skins, member create/edit/delete,
owner and board policy gates, pending moderation, pin/lock controls,
categories, rich-text image upload, comments, board-scoped search and category
discovery, home-page directory/feed blocks, a community-home pattern, a
theme-neutral style contract, plugin i18n catalogs, and an Admin dashboard
metric.

Anonymous posting, board passwords, attachment lists, view counters, and
board-specific moderator roles are not part of this first contract. They should
build on the shared community capability and audit surfaces instead of adding
parallel authentication or moderation systems inside the plugin.
