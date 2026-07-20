# Community Guide

> Phase 9 (sub-phases 9.1–9.7q + 9.5a/b + 9.6) ships
> NexPress's community layer — members, comments, reactions,
> follows, notifications, moderation, SSO, anti-spam, and
> reputation. This guide is the operator-facing companion to
> `community-design.md` (which captures the why and the
> design decisions); read this when you want to **use** the
> shipped surface.

---

## Table of Contents

1. [What's in the Box](#1-whats-in-the-box)
2. [Member Identity](#2-member-identity)
3. [Member Authentication](#3-member-authentication)
4. [SSO Providers](#4-sso-providers)
5. [Comments](#5-comments)
6. [Reactions, Views, and Follows](#6-reactions-views-and-follows)
7. [Notifications](#7-notifications)
8. [Member-Authored Content](#8-member-authored-content)
9. [Moderation Surface](#9-moderation-surface)
10. [Anti-Spam, Profanity, Reputation Adapters](#10-anti-spam-profanity-reputation-adapters)
11. [Bans](#11-bans)
12. [Roles and Capabilities](#12-roles-and-capabilities)
13. [Community Settings](#13-community-settings)
14. [Audit Log](#14-audit-log)
15. [Runtime Contract and Diagnostics](#15-runtime-contract-and-diagnostics)
16. [What's Not Built (Yet)](#16-whats-not-built-yet)

---

## 1. What's in the Box

The community layer is one cohesive system, but it ships as
many independent moving parts. Sites pick what they need:

- **Members** (Phase 9.1) — separate from staff `np_users`.
  Members register, log in, have public profiles, and earn
  scoped roles.
- **Comments** (Phase 9.2) — under any collection's documents,
  not just blog posts. Polymorphic `target_type` /
  `target_id`.
- **Reactions / follows / notifications** (Phase 9.3).
- **Forum** — `@nexpress/plugin-forum`, native board/post collections,
  document reactions, and daily-unique view receipts.
- **Moderation** (Phase 9.5 / 9.5a / 9.5b) — contextual reports queue,
  closed resolution actions, bans (scoped), audit log, role-grant UI.
- **SSO** (Phase 9.6a–e) — pluggable OAuth providers via
  `arctic`. GitHub + Google plugins ship in-tree.
- **Adapters** (Phase 9.6f–g) — `setSpamAdapter`,
  `setProfanityAdapter`, `setReputationAdapter`. Sites bring
  their own engine.
- **Member writes** (Phase 9.7a–q) — discussions members can
  start themselves; pending moderation queue; rich-text
  editor; image uploads with quota.

---

## 2. Member Identity

`np_members` is **separate** from `np_users` (the staff
table) — different auth flow, different role tree, different
sessions. The intent: members log into the site to comment
or post; staff log into `/admin` to moderate.

Schema highlights (`np_members`):

- `handle` — public, used in `/u/{handle}` URLs
- `email` — unique, optionally `email_verified`
- `password` — argon2 hashed, optional for SSO-only members
- `display_name` / `avatar` / `bio`
- `status` — `active`, `pending`, `suspended`, `deleted`, `imported`
- `reputation` — integer, mutated by `setReputationAdapter`

Public profile renders at `/u/{handle}` with a PII-free identity projection and
an exact, paginated Posts / Comments activity window. Only collections that
explicitly opt into the public projection participate:

```ts
defineCollection({
  // ...
  community: {
    comments: true,
    memberWrite: { create: true },
    profileActivity: { documents: true, comments: true },
  },
  timestamps: true,
  seo: {
    urlPath: (doc) => (typeof doc.slug === "string" ? `/articles/${doc.slug}` : null),
  },
});
```

`documents` requires member create support; `comments` requires comments.
Either projection also requires timestamps and `seo.urlPath`, so every visible
row can carry a validated local destination. Pending/private member documents,
non-visible comments, cross-site rows, and comments on pending/private targets
are excluded from both counts and pages. A pending, suspended, deleted, or
missing activity subject fails closed as not found. Core reads subject status,
count, page, and target documents from one repeatable-read snapshot and uses
stable tie-breakers for exact pagination.

`GET /api/members/{handle}` returns the exact `NpPublicMemberProfileWire`.
`GET /api/members/{handle}/activity?kind=documents|comments&page=1&limit=20`
returns `NpMemberProfileActivityPageWire`; `limit` is bounded to 50, and
unknown or repeated query parameters fail before runtime reads. The public
route owns authentication-neutral navigation and supplies prepared links,
locale-aware labels, and follow UI to an optional theme `impl.members.publicProfile`
renderer. Themes render those props and must not query collection tables or
reimplement visibility policy. Without that slot, the framework's complete
`.np-member-profile*` fallback remains active.

The site's `<MemberStatusWidget />` (theme-default header) shows the signed-in
member's avatar + handle + Sign out, or Sign in / Register links for anonymous
visitors.

---

## 3. Member Authentication

Standard email + password flow plus optional SSO:

| Endpoint                            | Purpose                             |
| ----------------------------------- | ----------------------------------- |
| `POST /api/members/register`        | Create account, send verify email   |
| `GET  /api/members/verify?token=…`  | Consume email-verify token          |
| `POST /api/members/login`           | Email + password → access + refresh |
| `POST /api/members/logout`          | Revoke session row + clear cookies  |
| `POST /api/members/refresh`         | Rotate refresh → new access token   |
| `POST /api/members/forgot-password` | Request reset email                 |
| `POST /api/members/reset-password`  | Consume reset token                 |
| `GET  /api/members/me`              | Profile of the authenticated member |

Tokens:

- **Access JWT** (`np-mb-session`) — signed by `NP_SECRET`,
  short TTL.
- **Refresh JWT** (`np-mb-refresh`) — long TTL. Access and refresh
  hashes share one `np_member_sessions` row keyed by their common
  session id. Refresh compare-and-swap rotates both hashes, and
  logout deletes the pair using whichever live token remains available.
- **CSRF** (`np-mb-csrf`) — separate from the staff
  `np-csrf` cookie so member tokens can't authorize admin
  writes and vice-versa.

The exact claims, cookie paths, status gate, rotation behavior, and
operator diagnostics are documented in [authentication.md](authentication.md).

Public site UI (Phase 9.7g/h) covers register, login, verify,
forgot-password, reset-password under `/members/...`. Sites
that disable self-registration set
`community.registrationEnabled: false` in admin
Settings → Community.

---

## 4. SSO Providers

`registerOAuthProvider({ id, label, ... })` adds OAuth entries to
the auth provider registry. The reference app reads that registry
on both staff login (`/admin/login`) and member login
(`/members/login`), so configured providers render as "Continue
with ..." buttons automatically on the audiences they support. Two
provider plugins ship in-tree:

- `@nexpress/plugin-oauth-github`
- `@nexpress/plugin-oauth-google`

Both wrap [`arctic`](https://arcticjs.dev) so the
authorization-code dance is maintained externally rather than
bespoke. They are already included in `defaultPlugins`; leave them
installed and configure credentials from one source.

Production env path:

```bash
NP_OAUTH_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
NP_OAUTH_GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
NP_OAUTH_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
NP_OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx
```

Admin-form path:

- GitHub: `/admin/plugins/oauth-github`
- Google: `/admin/plugins/oauth-google`

Env wins when both sources are populated. Set both env vars for a
provider or unset both; partial env is a doctor error and the plugin
refuses to register that provider rather than mixing env and DB
credentials.

The GitHub plugin also exposes an Audience setting. It defaults to
`staff` because a GitHub OAuth App accepts one Authorization callback
URL. Switch it to `member` only when that GitHub app is registered for
the member callback. The Google plugin is visible on both staff and
member login because Google OAuth web clients allow multiple redirect
URIs.

Callback URLs:

- Staff GitHub: `${SITE_URL}/api/auth/oauth/github/callback`
- Member GitHub: `${SITE_URL}/api/members/oauth/github/callback`
- Staff Google: `${SITE_URL}/api/auth/oauth/google/callback`
- Member Google: `${SITE_URL}/api/members/oauth/google/callback`

For GitHub, register only the callback that matches the configured
Audience. For Google, one client can cover both pools when both URLs
are registered exactly. After saving admin-form credentials, click
**Reload all** in `/admin/plugins` or restart the process so setup
runs again.

Linked identities surface in:

- **Admin Members → detail page** → "Linked identities" panel
  (Phase 9.6i) — staff can revoke an OAuth link
- **Admin Users → detail page** — same surface for staff users

---

## 5. Comments

`createComment({ targetType, targetId, bodyMd, memberId })`.
Polymorphic — `targetType` is an opted-in collection slug; forum post comments
therefore use the configured forum-post collection slug rather than a parallel
thread schema. Comments support:

- Nested replies via `parent_id`. Visual nesting is one
  level by default while the public tree preserves arbitrary depth. Offset
  pages can contain a reply without its parent; the shared client renders that
  row as a bounded detached root instead of dropping it or recursing.
- Hide / restore (Phase 9.5). Hidden comments stay in DB
  with `status = 'hidden'`; restore flips back to `'visible'`.
- Soft delete on member request (Phase 9.7l mass-delete-by-
  member action available to staff).
- Owner/moderator edits; soft-deleted comments cannot be edited back.
- Markdown rendering (`renderCommentMarkdown` — XSS-safe
  subset).

The public list endpoint returns one exact `NpCommentListWire` window:
`comments`, `totalDocs`, `limit`, `offset`, `hasNextPage`, and `hasPrevPage`.
Every list item retains `parentId` and adds a PII-free public author projection
(`handle`, `displayName`, resolved `avatarUrl`) plus the viewer-aware reaction
summary (`counts`, `mine`). Core resolves authors and reactions in bounded batch
queries, so clients must not issue one member or reaction request per row.
Suspended, deleted, or otherwise unavailable profiles become `author: null`.
Single create/edit responses remain the canonical persisted comment wire row.

`Comments` from `@nexpress/next/client` consumes that contract and provides
root/reply composers, owner edit and soft-delete controls, report/mute/reaction
actions, exact offset pagination, locale-aware timestamps, and host-supplied
labels. Stable styling hooks include `.np-comments`, `.np-comments-list`,
`.np-comment`, `.np-comment-card`, `.np-comment-author`, `.np-comment-actions`,
and `.np-comment-composer`. State is also exposed through
`data-np-comments`, `data-np-comment-id`, `data-np-comment-depth`,
`data-np-comment-owner`, `data-np-comment-status`,
`data-np-comment-detached`, and `data-np-comment-composer`. Themes may style
those hooks but should not duplicate the API or comment state machine.

Spam + profanity adapter checks fire at create time
(Phase 9.7n stacked profanity → spam, reject short-circuits).
Edits go through the same gates (Phase 9.7n closed #123).

---

## 6. Reactions, Views, and Follows

`addReaction({ memberId, targetType, targetId, kind })` with
idempotent `ON CONFLICT` insert. The set of allowed `kind`
values is gated by the admin's `community.reactionKinds`
allow-list — defaults to `["like"]`, sites add
`["like", "love", "celebrate", ...]`.

Targets may be `comment` or a published public document from a collection that
explicitly sets `community.reactions: true`. Document reactions use the same
site boundary, collection-scoped ban checks, recipient notification, and
reputation event as comments. A disabled collection or missing/private target
fails before insertion.

Collections opt into anonymous daily-unique document views separately with
`community.views: true`. `POST /api/views` owns an HttpOnly first-party
`np-visitor` cookie and passes only its SHA-256 digest to Core. Core derives a
second site/target/day-scoped digest, so persisted rows cannot use one stable
identifier to connect a visitor across documents or days. `np_content_views`
stores no raw cookie, IP address, or user agent and has one unique row per
site, target, scoped digest, and UTC day. Only published public documents can
receive a view.

`npListContentEngagement(targetType, targetIds)` batches views, visible
comments, and reactions for up to 200 unique IDs in input order. This is the
supported list/feed primitive; callers should not issue reaction or comment
count queries once per row.

`follow({ followerId, targetType, targetId })` accepts either the reserved
`member` target or a canonical collection slug. Document subscriptions require
that collection to declare `community.follows: true`; Core then validates the
document is published, public, on the current site, and exposes a validated
local destination through `seo.urlPath` before inserting the follow. The former
placeholder `thread` and `tag` enum values never had runtime
subjects and are no longer advertised. Custom forum collection slugs work
without a generic thread alias.

`notifyFollowers()` is the server-side fan-out primitive for activity on a
followed document. Its exact tagged payload currently distinguishes
`comment.created` from `document.published`, requires one validated local
destination path, and reads followers in bounded 200-row cursor pages. The
normal mute and per-kind preference gates still apply to every recipient.
Document deletion removes its polymorphic follow rows in the same transaction.

Counts remain available through `countReactions(targetType, targetId)`. The
forum detail updates its recommendation state after a successful request and
refreshes the canonical summary; no realtime push is implied.

Collections opt into document reports independently with
`community.reports: true`. The report target is the canonical collection slug,
not a generic `thread` alias, so custom forum collection names resolve through
the same registry and site boundary as their documents. Reserved targets are
`comment` and `member`; replies use `comment` because every reply is an
`np_comments` row, and collections using either reserved slug cannot enable
document reports. Only visible comments, active members, and published public
documents can be reported. A partial unique index permits at most one
unresolved report per site, reporter, and target while allowing a new report
after the earlier case is closed and the target is public again.

---

## 7. Notifications

`np_notifications` rows fire on:

- Comment under your own collection document
- Reply to your comment
- Reaction on your comment / doc
- New follow
- New activity on a subscribed collection document
- Mention — Phase 16.2 wired `@handle` parsing into the
  notification fan-out, firing `comment.mention` or
  `document.mention` rows.

Each row has `kind`, bounded `payload` JSON, `read_at`, and a tenant-scoped
`site_id`. Event payloads carry the relevant actor and target identifiers.
Known activity destinations are validated as local paths before storage and
again before the member inbox renders a View link. Opening that link also marks
the notification read. Members read their own via
`GET /api/notifications` (`?count=1` returns only `{ unread }`;
`?unread=1` filters to unread rows) and mark rows read via
`POST /api/notifications/mark-read` with either `{ ids: [...] }`
or `{ all: true }`.

Members manage the in-app inbox, per-kind toggles, and digest
cadence at `/members/me/notifications`. The
`notifications:sendDigest` recurring job (pg-boss) batches unread
notifications into daily or weekly email summaries for members who
opt in. With `NoopEmailAdapter` (default), rows stay in DB and the
in-app inbox still works, but digest mail is not delivered.

Notification preferences are an exact JSONB contract. `{}` is the compact
default and expands to `disabled: []`, `digest: "off"`, and empty digest
timestamps. Present fields must be valid and unknown keys fail closed; the
runtime never drops malformed entries or silently rewrites them as defaults.

---

## 8. Member-Authored Content

Member-authored documents build on the same collection pipeline as staff
writes:

- `community.memberWrite.create/update/delete` opts a collection into the
  owner-gated member path.
- `writableFields` limits the exact declared fields a member request may
  submit. Framework fields and omitted operator-only fields remain locked.
- `access.create/update/delete` adds row-aware policy after authentication,
  ownership, and ban gates. `resolveCreateStatus` can derive `published` or
  `pending` from validated runtime data; spam flags still force `pending`.
- Pipeline stamps `member_author_id` on member writes
  so owner-only update / delete works without staff.
- Pending queue at `/admin/community/pending` — staff
  Approve (promotes to published, fires deferred `document.created`
  reputation event) or Reject (deletes).
- The bundled forum uses those contracts for dynamic boards:
  - `/boards` — published board index
  - `/boards/[boardKey]` — board list and member's own pending posts
  - `/boards/[boardKey]/new` — member composer
  - `/boards/[boardKey]/[postId]/edit` — owner-gated edit
- Rich-text editor (`@nexpress/editor`) with image upload
  (Phase 9.7j; image uploads go through the member upload
  endpoint with the `community.memberUploadQuota.{perDay,
total}` rate limit from Phase 9.7p).

See [plugin-forum.md](plugin-forum.md) for board policy, Admin settings, and
the skin contract.

---

## 9. Moderation Surface

Three admin pages:

| Page                        | What it shows                        |
| --------------------------- | ------------------------------------ |
| `/admin/community/reports`  | Contextual report queue and actions  |
| `/admin/community/comments` | Comments table with hide / restore   |
| `/admin/community/pending`  | Member-authored docs awaiting review |
| `/admin/community/bans`     | Active bans + revoke                 |
| `/admin/community/settings` | Community config                     |

Per-member actions on `/admin/members/[id]`:

- **Bans panel** (Phase 9.5a) — issue / revoke; site /
  category / collection scope; permanent or expiring.
- **Roles panel** (Phase 9.5b) — grant `category-mod` /
  `collection-mod` / `community-mod` with optional scopeId + expiresAt.
- **Linked identities panel** (Phase 9.6i) — list + revoke
  OAuth connections.
- **Purge content panel** (Phase 9.7l, admin-only) — mass
  delete every comment, member-doc, and member-uploaded
  media owned by the member. Idempotent.

Cascade behavior (Phase 9.7m / 9.7q): deleting a doc
cascade-deletes its comments, reactions, view receipts, and reports. Deleting
a comment cascades reactions on it.

The report queue resolves each target to an exact operator-safe projection:
label, excerpt, current status, author where available, and a link to the
Admin document/member surface. A missing or cross-site target is shown as
unavailable rather than crashing the queue. Resolution accepts only three
actions: `dismiss`, `hide-comment`, and `unpublish-document`. Target/action
mismatches fail before mutation. Comment hiding and document unpublishing use
the existing moderation and collection pipelines; document reports move the
row to `pending` review while retaining validation, revisions, hooks, jobs,
and the unpublish lifecycle. Resolutions for the same site and target serialize,
so concurrent moderators cannot repeat target transition side effects.

---

## 10. Anti-Spam, Profanity, Reputation Adapters

Three optional adapters; default to no-op:

```ts
import { setSpamAdapter, setProfanityAdapter, setReputationAdapter } from "@nexpress/core/community";

setSpamAdapter({
  check: async (text, context) => {
    // Return one of:
    //   { kind: "pass" }
    //   { kind: "flag", reason, metadata }
    //   { kind: "reject", reason }
  },
});

setProfanityAdapter({
  check: async (text, context) => /* same shape */,
});

setReputationAdapter({
  apply: async (event) => 5,
});
```

Spam and profanity results are checked at dispatch. A thrown adapter or a
malformed result does not block the write, but it is converted to `flag`, the
content lands in `pending`, and Admin Health records the contained failure.
Verdicts:

- `pass` — write goes through with default status.
- `flag` — write goes through but lands as `pending`; the audit row
  records the verdict.
- `reject` — 400 with the verdict's reason.

Profanity runs **before** spam (language-level check before
intent-level). Either side's `reject` short-circuits.

Reputation adapters are fail-soft: their failure never rolls back the
community write. Events are exact tagged unions and deltas must be finite safe
integers. Invalid or fractional deltas are skipped and diagnosed rather than
truncated.

Reputation events the framework emits:

- `comment.created` / `comment.hidden` / `comment.deleted`
- `reaction.received` / `reaction.removed`
- `document.created` (deferred until publish for pending docs
  per Phase 9.7c)
- `document.deleted`

---

## 11. Bans

`issueBan({ memberId, scope, kind, expiresAt?, reason })`:

- `scope`: `"site"` (everything), `"category"` (forum
  category), `"collection"` (one collection slug)
- `kind`: `"temporary"` (with `expiresAt`) or `"permanent"`
- Atomic: rejects if an overlapping active ban exists

Enforcement points (`assertNotBanned` is the gate):

- Comment create / edit
- Reaction add (site-wide bans plus the collection scope resolved from either
  a comment or document target)
- Member-authored doc create / update / delete
- Reports filing
- Member media upload

Bans surface on `/admin/community/bans` and on each member's
detail page.

---

## 12. Roles and Capabilities

Members default to `member`. Staff can grant scoped community
roles:

- `category-mod` — moderate one forum category
- `collection-mod` — moderate comments on one collection
- `community-mod` — moderate community content site-wide

`memberCan(memberId, action, target)` resolves grants in
priority order: site-wide member roles → scoped grants →
default `member` capabilities. Staff users always pass
(short-circuited via `can(user, "community.moderate")`).

Capability matrix lives in `packages/core/src/community/can.ts`.
The matrix is the source of truth — UI buttons read it via
the `memberCan` helper rather than hardcoding role names.

---

## 13. Community Settings

`/admin/community/settings` controls:

- **`registrationEnabled`** — toggle self-register endpoint
- **`reactionKinds`** — allow-list (`like`, `love`, etc.)
- **`memberUploadQuota.perDay` / `.total`** — `null` = unlimited

Stored in `np_settings` under `community` key, per-site
(Phase 15.4 — multi-site siteId scope).

---

## 14. Audit Log

`recordAuditEvent({ actor, kind, target, payload })` rows
land in `np_audit_events` for every staff-initiated state
change:

- `member.ban.issue` / `member.ban.revoke`
- `member.role.grant` / `member.role.revoke`
- `member.identity.revoke` / `user.identity.revoke`
- `comment.hide` / `comment.restore`
- `document.flag` / `document.promote`
- `member.content.purge` (mass delete)

Surfaces in `/admin/audit` (filtered list). The actor
reference is polymorphic: staff (`user.id`), member
(`member.id`), or `system` for adapter-driven actions.

Phase 17 added a nullable `site_id` column to `np_audit_events`
and an index on `(site_id, created_at)`. `recordAuditEvent`
fills it from the current request's site (resolved by the
multi-site proxy), so multi-tenant operators can now
filter audit events by site without joining through the
target. Events that don't belong to a single site
(super-admin actions, scripts, background jobs without a
request scope) leave `site_id` null.

---

## 15. Runtime Contract and Diagnostics

`@nexpress/core/community-contract` is the client-safe boundary shared by
Core, API routes, Admin/member views, plugin-facing registries, plugin doctor,
and live health. It exports the exact request, persisted-row, wire-row,
settings, notification-preference, engagement/view/follow, public profile and
activity, moderation, reputation, and role-catalog validators without importing
the server-only Core runtime.

Community inputs are exact and bounded: unknown keys, malformed dates and ids,
invalid tagged unions, sparse arrays, accessors, non-JSON payloads, and broken
cross-field invariants fail closed. Database rows are validated before they
leave community services, and `Date` values are serialized into the matching
wire contract before an API response reaches a browser client. Audit actor and
target pairs are validated before the best-effort insert, and reputation events
must name the same recipient whose score would be updated.

`plugin doctor` reports malformed community settings and persisted rows as
`community.contract`, including malformed `np_content_views` rows, invalid or
orphaned report/follow targets, cross-site document targets, and unresolved
report duplicates. Adapter and registry failures are contained in a bounded runtime
diagnostic buffer and surface as the `community` row in Admin Health;
they are not silently converted into successful moderation or reputation
results. Malformed persisted notification preferences also emit a runtime
diagnostic and fail closed for the notification side effect without rolling
back the community write that triggered it; unrelated transient preference
read failures remain fail-open. Comment notification fan-out failures are also
contained after the durable comment write and recorded in that diagnostic
buffer, so a delivered comment is never reported to its author as a failed
write merely because an inbox side effect failed.

---

## 16. What's Not Built (Yet)

In rough order of likely impact:

- **Real-time push** — counts and lists update on next
  render, no WebSocket / SSE.
- **Comment sort orders beyond `newest`, `oldest`, and `top`** —
  "Controversial" remains intentionally unimplemented.
- **DMs / private messaging** — design doc explicitly
  defers; out of scope.
- **Federated identity (ActivityPub)** — design doc defers;
  out of scope.

### Recently closed

- **Member-to-member block / mute** — Phase 16.1 (#204).
- **`@mention` notifications** — Phase 16.2 (#205).
  `@handle` fan-out fires `notification:mention` rows.
- **Email digest / batched notifications** — Phase 16.4
  (#207). Per-member opt-in to a daily digest.
- **Notification preferences UI** — Phase 16.3 (#206).
  Members can opt out per `kind`.
- **Collection-native document reports** — report-enabled collections use
  their real slug; replies share the reserved `comment` target.
- **Site-scoped community tables** — Phase 18 (#211)
  added `site_id` to `np_comments`, `np_reactions`,
  `np_content_views`, `np_follows`, `np_member_mutes`, `np_notifications`,
  `np_reports`, and `np_bans`. `np_members` itself is
  still global (one identity, many tenants).

These aren't blockers. The shipped surface is enough to run
a real community site; each item above becomes obvious only
when traffic patterns surface a specific need.
