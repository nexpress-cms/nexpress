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
  defaultSkinId: "classic",
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

## Routes

| Route                            | Surface | Purpose                                 |
| -------------------------------- | ------- | --------------------------------------- |
| `/boards`                        | site    | Published board index                   |
| `/boards/:boardKey`              | site    | Classic board list and author filter    |
| `/boards/:boardKey/new`          | member  | Authenticated member composer           |
| `/boards/:boardKey/:postId`      | site    | Post body, author actions, and comments |
| `/boards/:boardKey/:postId/edit` | member  | Owner-only edit form                    |

`surface: "member"` selects member chrome; the server route and collection
pipeline still perform the authentication and ownership checks.

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

The factory rejects malformed IDs, duplicate IDs, incomplete render contracts,
and an unregistered default skin during module evaluation. The built-in
`classic` skin remains available alongside custom skins. The composer props
contain route-owned form or authentication content, so skins control the
create/edit presentation without duplicating member authentication, ownership,
upload, or collection-write policy. Projects that do not consume
`@nexpress/app/styles/globals.css` should import
`@nexpress/plugin-forum/styles.css` themselves.

## Current boundary

The foundation includes multi-board Admin configuration, classic
index/list/detail/composer skin, member create/edit/delete, owner and board
policy gates, pending moderation, pin/lock controls, categories, rich-text
image upload, comments, plugin i18n catalogs, and an Admin dashboard metric.

Anonymous posting, board passwords, attachment lists, view counters, and
board-specific moderator roles are not part of this first contract. They should
build on the shared community capability and audit surfaces instead of adding
parallel authentication or moderation systems inside the plugin.
