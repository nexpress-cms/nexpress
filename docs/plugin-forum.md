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
3. Choose the skin, read audience, member-write mode, moderation mode, comment
   default, attachment limits, page size, and optional categories.
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
| Who can read this board     | Everyone, signed-in members, or scoped moderators                      |
| Who can create posts        | `members`, `staff`, or `closed`                                        |
| New member posts            | Publish immediately or enter the shared Admin pending queue            |
| Allow comments on new posts | Sets new posts to unlocked or locked; staff can change each post later |
| Posts per page              | Board-specific list size from 5 to 100                                 |
| Categories                  | Stable key plus display label pairs, scoped to the board               |
| Allow attachments           | Allows new files; existing files stay visible/removable if disabled    |
| Maximum attachments         | Board-specific cap from 1 to 20 files                                  |
| Maximum attachment size     | Per-file cap from 1 to 25 MiB                                          |

Staff can manage `pinned`, `locked`, and status from the Forum posts collection.
Declared category/site moderators receive the same exact state transitions on
the public detail route, plus board-list pending/report indicators and inline
report handling. Their list includes published posts and eligible member or
previously-hidden pending posts, including pending rows that were pinned before
moderation; initial staff drafts never cross this member surface. Members can
submit only `board`, `title`, `body`, `category`, `attachments`, and
`audience`. A post can be public, member-only, or private to its author and
scoped moderators, but never broader than its board. Narrowing a board is
rejected until every existing post uses an equally restrictive audience; this
keeps direct URLs and discovery consistent without a non-atomic background
rewrite. The core
member-write pipeline rejects any attempt to send operator fields before
moderation or persistence, checks the current board policy, prevents authors
and scoped moderators from moving a post to another board, and derives
`published` versus `pending` from that board. A spam/profanity `flag` still
forces `pending` even when the board normally publishes immediately.

Deleting a board with posts is intentionally restricted by the relationship
foreign key. Move or delete its posts first so a stale post can never point to
a missing board.

## Attachments

The composer uploads attachments through the member-owned media endpoint and
persists only exact `{ file: <media UUID> }` rows on the post. Forum storage is
therefore not a parallel blob system: `np_media` owns each object and the
normal document media-reference table tracks its use. Removing a newly added
file deletes it immediately; removing an existing file deletes it after the
post update succeeds. If a browser is closed before saving, the upload remains
an unreferenced media row for normal operator cleanup rather than risking the
deletion of a file another request has already attached.

Supported extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `pdf`, `zip`,
`7z`, `rar`, `gz`, `txt`, `csv`, `md`, `hwp`, `hwpx`, `doc`, `docx`, `xls`,
`xlsx`, `ppt`, `pptx`, `odt`, `ods`, and `odp`. Upload accepts a safe basename
only and requires the extension, browser-declared MIME type, and file
signature/container to agree. SVG, HTML, executable formats, empty files,
binary data disguised as text, and files above the framework or board cap fail
before persistence. Text and CSV inspection accepts UTF-8 and Korean
CP949/EUC-KR. Members may attach only their own active uploads; staff retain
the normal collection-management path.

Lowering or disabling a board policy does not trap old posts: an owner may
save or remove attachments that were already accepted, but cannot add a new
file outside the current policy.

`GET /api/media/attachments/:id` is available to the uploader while the file
is unreferenced. A document reference grants download only when the current
viewer may read it: anonymous for `public`, signed-in members for `members`,
and the author/scoped moderator for `private`. Pending rows remain limited to
their author or moderator. Every successful response
uses `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a
sandbox CSP, and `private, no-store`; user content is never rendered inline.
`DELETE /api/members/media/attachments/:id` is uploader-only and returns a
conflict while any document reference remains.
Core serializes reference creation and soft-delete on the media row, ensuring
that concurrent submit/delete requests cannot leave a post pointing at a
deleted object.

Changing the forum attachment or audience fields changes the generated
collection schema. After adding or upgrading the plugin, regenerate, review,
and apply the migration:

```bash
pnpm schema:gen
pnpm db:generate
pnpm db:migrate
```

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
audience, category, and member filters in one collection query. Private posts
appear in the author's `author=me` view or a moderator view, not an ordinary
member list. Pinned notices appear
only on the unfiltered public first page, so they cannot pollute filtered or
ranked results. Filter state is preserved by category, author, and pagination
links.

## Routes

| Route                            | Surface | Purpose                                  |
| -------------------------------- | ------- | ---------------------------------------- |
| `/boards`                        | site    | Published board index                    |
| `/boards/:boardKey`              | site    | Searchable and filterable post list      |
| `/boards/:boardKey/new`          | member  | Authenticated member composer            |
| `/boards/:boardKey/:postId`      | site    | Post body, engagement, actions, comments |
| `/boards/:boardKey/:postId/edit` | member  | Owner or scoped-moderator edit form      |

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
boards. Both skins expose the same route-owned view, visible-comment, and
document-reaction totals, moderation state/report badges, exact action set,
and inline report panel. The full skin additionally exposes notices,
categories, search, member filtering, numbered pagination, author avatars and
display names, created/updated dates, pin/lock/moderation state, comments,
owner actions, member report actions, and route-owned composers.

## Engagement contract

Forum boards and posts opt into Core document subscriptions, while posts also
enable the four engagement/moderation features:

```ts
community: {
  audience: true,
  comments: true,
  reactions: true,
  views: true,
  follows: true,
  reports: true,
  moderation: {
    categoryField: "board",
    hiddenField: "moderationHidden",
    lockField: "locked",
    pinField: "pinned",
  },
}
```

`moderationHidden` is an internal required checkbox with `defaultValue: false`.
It records whether a pending post was previously published, preventing a
restore from being mistaken for first approval. Because this adds a collection
column, upgrades must regenerate and apply the project migration using the
commands in [Attachments](#attachments).

`community.audience: true` binds the collection to one required top-level
`audience` select whose exact values are `public`, `members`, and `private` and
whose default is `public`. Core consumes the same declaration for comments,
reactions, follows, reports, mentions, profile activity, search, sitemap/feed,
and attachment downloads. Invalid persisted values fail closed and reach
Doctor. Public cross-collection search stays on the built-in Postgres path
when its catalog contains an audience-aware collection; external adapters do
not yet receive a viewer-audience proof in their request contract.
The board collection additionally declares `audienceCategoryField: "id"`, so
an exact board-scoped category moderator can read and subscribe to that
moderator-only board without granting site-wide access.

`community.reactions` extends the existing reaction API from comments to
published documents readable by the current member. The site's exact
`community.reactionKinds` allow-list still gates kinds, member authentication
and CSRF still gate mutations, and collection/site-scoped bans still apply.
The detail route uses `like` as the forum recommendation action.

`community.views` enables `POST /api/views`. The anonymous endpoint writes at
most one receipt per target, first-party browser visitor, and UTC calendar day.
The raw HttpOnly `np-visitor` value, IP address, and user agent are never
persisted. Core stores only a site/target/day-scoped derivative of the
browser-side SHA-256 digest, preventing persisted rows from carrying one
cross-document visitor identifier. The proxy exempts this single anonymous
endpoint from CSRF and bounds it to 120 requests per IP per minute.

`npListContentEngagement(targetType, targetIds)` aggregates views, visible
comments, and per-kind reactions in three site-scoped grouped queries. Calls
are capped at 200 unique document IDs, preserve input order, and return zeroes
for missing activity. Lists, skins, and home feeds use this batch contract
instead of issuing per-post queries. Document deletion removes its comments,
document reactions, and view receipts; site deletion and `plugin doctor`
include the view table as well.

`community.reports` adds a member-only report action to readable published forum
post details. The request uses the configured forum-post collection slug, so a
site that renames `collections.posts` does not depend on a hard-coded `thread`
target. The Core service rejects missing, unreadable, pending, or cross-site
documents and duplicate unresolved reports. Admin Reports shows the post title,
status, and collection edit link; `unpublish-document` moves the post to
`pending`, while `dismiss` closes the case without changing it. Comments keep
using the shared `comment` report target and `hide-comment` action. A category
moderator sees unresolved direct and nested-comment cases on that same detail
page and can hide the target or dismiss the case. Collection moderators can
triage the collection's cases but never receive a thread-state action they do
not hold. Every resolution is re-authorized by the API; the skin does not own
scope or report policy.

## Subscription and notification contract

Both forum collections declare `community.follows: true`. The board list route
passes a route-owned board subscription action into either skin; the detail
route does the same for one post. Signed-out readers receive a login link that
preserves the current URL. Authenticated toggles use the exact shared
`/api/follows` and `/api/follows/check` contracts and expose
`data-np-forum-subscription="available|subscribed|signed-out"` for independent
theme styling.

A published forum post runs the plugin's `content:afterPublish` handler and
fans one `document.published` event out to subscribers of its board. A visible
comment runs the Core `comment.created` fan-out for subscribers of that post.
Recipient priority is direct reply, mention, document owner, then general
subscription, so one member never receives several notifications for the same
comment. Pending content does not notify. Member-only/private activity reaches
only subscribers who can still read both the followed board and target post;
revoked access is checked again during fan-out. The commenter/post author is
excluded from their own event; mutes and notification preferences remain in
force. Every forum notification carries the configured `basePath`, board key,
and post id as a validated local destination. The member inbox and existing
daily/weekly digest recognize the new activity kind.

The database keeps the existing polymorphic `np_follows` shape, but the public
target is now either `member` or an actual follow-enabled collection slug. The
never-functional `thread` and `tag` placeholders are not part of the runtime
contract. Deleting a board or post removes its follows transactionally, and
`plugin doctor` reports malformed, missing-collection, orphaned, or cross-site
follow targets.

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
skin during module evaluation. The detail props contain resolved attachment
descriptors and the composer props contain route-owned form or authentication
content, so skins control presentation without duplicating member
authentication, file ownership, upload, download visibility, or
collection-write policy. Projects that do not consume
`@nexpress/app/styles/globals.css` should import
`@nexpress/plugin-forum/styles.css` themselves.

Detail skins must place `authorActions`, `reportAction`, `subscriptionAction`,
and `moderationPanel`. They are separate route-owned nodes: the first contains
the exact owner or scoped-moderator post actions, the second appears only to
another authenticated member on a published public post, the subscription
action owns its authenticated or login-required state, and the panel contains
only server-authorized report actions. Skins may arrange them together, but
must not reimplement report/follow targets, authentication, scope resolution,
or CSRF behavior.

Post-list skins receive route-owned `subscriptionAction`, the parsed `query`, `searchMaxLength`, and a
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
| `forum.post-feed`       | Bounded latest, pinned-notice, or recent-popularity feed       |

The directory supports 1–100 boards, automatic or fixed columns, and toggles
for descriptions, categories, and policy labels. The feed supports 1–20 rows,
list or card layout, optional board scoping, and board/category/author/date/
engagement visibility toggles. Leave `boardKey` empty to aggregate active boards; an
unknown key renders the empty state, while a value outside the board's exact
2–63 character key contract fails before a query.

`latest` excludes pinned notices so it composes without duplicates beside a
`notices` feed. `popular` scans at most the 200 newest non-notice candidates
inside a configurable 1–90 day window (7 days by default), then ranks them by
`views + comments × 4 + reactions × 6`. This is a bounded recent-popularity
signal, not an unbounded all-time table scan. Equal scores fall back to newest
creation time and then stable document ID. Cross-board results retain only
rows whose board relation and immutable board-key snapshot agree with an
active public board. Collection
reads remain site-scoped, anonymous visibility filtering remains active, and
only `published` posts reach either feed. Malformed, stale, private, draft, or
orphaned state therefore fails closed instead of leaking into a home page.

The `forum.community-home` pattern composes a board directory, notice list,
popular-discussion cards, and latest-discussion cards. It references only
forum-owned blocks and remains available under every theme.

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
composer, attachment list/items, comments, board-directory block, post-feed
block, and feed items. Attachment markup uses
`data-np-forum-attachments="list"` and `data-np-forum-attachment="<mediaId>"`.
It also publishes `engagement` and `engagement-summary` slots backed by
`data-np-forum-engagement="post|summary"`; individual totals expose
`data-np-forum-metric="views|comments|reactions"`.
The `subscription` slot targets `[data-np-forum-subscription]`; themes may style
that stable state hook without importing the plugin client component.
Moderator surfaces expose `data-np-forum-moderation="reports"`,
`data-np-forum-report="<reportId>"`,
`data-np-forum-moderation-action="hide|restore|lock|unlock|pin|unpin"`, and
`.np-forum-report-badge` without coupling a theme to either bundled skin.
The `comments` slot continues to target the plugin-owned `.np-forum-comments`
wrapper. Inside it, the framework comment contract exposes
`data-np-comments="thread"`, `data-np-comment="item"`, author/action/composer
classes, and explicit owner/depth/status/detached state hooks. Both bundled
skins pass the plugin locale and full comment-action catalog into the shared
component; a theme can therefore restyle the experience without importing the
forum or owning reply, edit, delete, report, mute, reaction, or pagination
behavior.
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
categories, validated member attachments, rich-text image upload, localized
threaded comments with public author identity, owner controls, and pagination,
board-scoped search and category
discovery, daily-unique views, document recommendations, batched engagement
counts, board/post subscriptions, deduplicated actionable notifications,
bounded popular ranking, home-page directory/feed blocks, a
community-home pattern, a theme-neutral style contract, plugin i18n catalogs,
an Admin dashboard metric, and explicit public member-profile document/comment
activity. Forum posts opt into Core's generic profile projection and expose
their configured UUID detail route through `seo.urlPath`; neither skin nor a
theme queries the forum collections to build member activity.

Anonymous posting and board passwords are not part of this contract. Board
moderation is intentionally supplied by Core's shared `category-mod` role,
capability, scoped-ban, report, and audit surfaces rather than a parallel role
system inside the plugin.
