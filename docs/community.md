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
6. [Reactions and Follows](#6-reactions-and-follows)
7. [Notifications](#7-notifications)
8. [Member-Authored Content](#8-member-authored-content)
9. [Moderation Surface](#9-moderation-surface)
10. [Anti-Spam, Profanity, Reputation Adapters](#10-anti-spam-profanity-reputation-adapters)
11. [Bans](#11-bans)
12. [Roles and Capabilities](#12-roles-and-capabilities)
13. [Community Settings](#13-community-settings)
14. [Audit Log](#14-audit-log)
15. [What's Not Built (Yet)](#15-whats-not-built-yet)

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
- **Forum** (Phase 9.4) — `@nexpress/plugin-forum`,
  `discussions` collection, no new community-only tables.
- **Moderation** (Phase 9.5 / 9.5a / 9.5b) — reports queue,
  bans (scoped), audit log, role-grant UI.
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
- `status` — `active`, `banned`, `deleted`
- `reputation` — integer, mutated by `setReputationAdapter`

Public profile renders at `/u/{handle}`. The site's
`<MemberStatusWidget />` (theme-default header) shows the
signed-in member's avatar + handle + Sign out, or
Sign in / Register links for anonymous visitors.

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
- **Refresh JWT** (`np-mb-refresh`) — long TTL, rotates per
  refresh, persisted as `np_member_sessions` rows so logout
  revokes immediately (Phase 9.7 closed #45 here — pure JWT
  refresh would have left logout cosmetic).
- **CSRF** (`np-mb-csrf`) — separate from the staff
  `np-csrf` cookie so member tokens can't authorize admin
  writes and vice-versa.

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

`createComment({ targetType, targetId, body, memberId })`.
Polymorphic — `targetType` can be any collection slug, plus
`thread` / `reply` (forum) and any future surface that opts
in. Comments support:

- Nested replies via `parent_id`. Visual nesting is one
  level by default; the column allows arbitrary depth for
  future "Reddit-style" themes.
- Hide / restore (Phase 9.5). Hidden comments stay in DB
  with `status = 'hidden'`; restore flips back to `'visible'`.
- Soft delete on member request (Phase 9.7l mass-delete-by-
  member action available to staff).
- Edit window (per `community.editWindowMinutes` setting).
- Markdown rendering (`renderCommentMarkdown` — XSS-safe
  subset).

Spam + profanity adapter checks fire at create time
(Phase 9.7n stacked profanity → spam, reject short-circuits).
Edits go through the same gates (Phase 9.7n closed #123).

---

## 6. Reactions and Follows

`addReaction({ memberId, targetType, targetId, kind })` with
idempotent `ON CONFLICT` insert. The set of allowed `kind`
values is gated by the admin's `community.reactionKinds`
allow-list — defaults to `["like"]`, sites add
`["like", "love", "celebrate", ...]`.

`follow({ memberId, targetType, targetId })` for users
following members or threads. Generates `notification:follow`
fan-out events.

Counts via `countReactions({ targetType, targetId })`. Live
on the comment / doc detail page; updates pessimistically on
the next render (no realtime push).

---

## 7. Notifications

`np_notifications` rows fire on:

- Comment under your own thread / reply / member doc
- Reply to your comment
- Reaction on your comment / doc
- New follow
- Mention — Phase 16.2 wired `@handle` parsing into the
  notification fan-out, firing `notification:mention` rows.

Each row has `kind`, `actor_id`, `target_type`, `target_id`,
`payload` JSON, `read_at`. Members read their own via
`GET /api/members/notifications` and mark-read via
`PUT /api/members/notifications/:id/read` /
`PUT /api/members/notifications/read-all`.

The `notification:email` job (pg-boss) routes to the
configured email adapter when delivery is configured. With
`NoopEmailAdapter` (default) the rows stay in DB but no
mail goes out — the in-app inbox still works.

---

## 8. Member-Authored Content

Phase 9.7a–q layered "members can write things" on top of
the comment surface:

- `defineDiscussionsCollection({ memberWrite: true })` — the
  forum's discussions collection accepts member-authored
  threads. `community.memberWrite.create: true` and
  `defaultStatus: "pending" | "published"` per collection.
- Pipeline stamps `member_author_id` on member writes
  (Phase 9.7b codegen) so owner-only update / delete works
  without staff.
- Pending queue at `/admin/community/pending` — staff
  Approve (promotes to published, fires deferred `document.created`
  reputation event) or Reject (deletes).
- Site UI:
  - `/discussions` — public list
  - `/discussions/new` — member-authored thread form
  - `/discussions/[slug]/edit` — owner-gated edit
  - "My threads" tab (logged-in members) shows pending
    submissions to their author
- Rich-text editor (`@nexpress/editor`) with image upload
  (Phase 9.7j; image uploads go through the member upload
  endpoint with the `community.memberUploadQuota.{perDay,
total}` rate limit from Phase 9.7p).

---

## 9. Moderation Surface

Three admin pages:

| Page                        | What it shows                        |
| --------------------------- | ------------------------------------ |
| `/admin/community/reports`  | Open reports queue (Phase 9.5)       |
| `/admin/community/comments` | Comments table with hide / restore   |
| `/admin/community/pending`  | Member-authored docs awaiting review |
| `/admin/community/bans`     | Active bans + revoke                 |
| `/admin/community/settings` | Community config                     |

Per-member actions on `/admin/members/[id]`:

- **Bans panel** (Phase 9.5a) — issue / revoke; site /
  category / collection scope; permanent or expiring.
- **Roles panel** (Phase 9.5b) — grant `category-mod` /
  `member-mod` etc. with optional scopeId + expiresAt.
- **Linked identities panel** (Phase 9.6i) — list + revoke
  OAuth connections.
- **Purge content panel** (Phase 9.7l, admin-only) — mass
  delete every comment, member-doc, and member-uploaded
  media owned by the member. Idempotent.

Cascade behavior (Phase 9.7m / 9.7q): deleting a doc
cascade-deletes its comments, reactions, and reports. Deleting
a comment cascades reactions on it.

---

## 10. Anti-Spam, Profanity, Reputation Adapters

Three optional adapters; default to no-op:

```ts
import { setSpamAdapter, setProfanityAdapter, setReputationAdapter } from "@nexpress/core/community";

setSpamAdapter({
  check: async ({ text, member }) => {
    // Return one of:
    //   { kind: "pass" }
    //   { kind: "flag", reason, metadata }
    //   { kind: "reject", reason }
  },
});

setProfanityAdapter({
  check: async ({ text }) => /* same shape */,
});

setReputationAdapter({
  apply: async ({ event, memberId }) => {
    // Mutate `np_members.reputation` atomically.
  },
});
```

Adapters fail-open: a thrown error logs + treats as `pass`.
Verdicts:

- `pass` — write goes through with default status.
- `flag` — write goes through but lands as `pending` (member
  doc) or `hidden` (comment); audit row records the verdict.
- `reject` — 400 with the verdict's reason.

Profanity runs **before** spam (language-level check before
intent-level). Either side's `reject` short-circuits.

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
- Reaction add (site-wide bans, plus collection-scoped bans for
  comment targets)
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
- `member-mod` — moderate any member's writes site-wide

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
- **`editWindowMinutes`** — how long after creating a comment
  the author can still edit

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

## 15. What's Not Built (Yet)

In rough order of likely impact:

- **Real-time push** — counts and lists update on next
  render, no WebSocket / SSE.
- **Comment sort orders beyond `top`** — Phase 16
  added `top` (sort by reaction count, #201) on top of
  chronological. "Controversial" / "newest" still not
  surfaced.
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
- **Reports for thread / reply targets** — #197 enabled
  `thread` / `reply` as report target types.
- **Site-scoped community tables** — Phase 18 (#211)
  added `site_id` to `np_comments`, `np_reactions`,
  `np_follows`, `np_member_mutes`, `np_notifications`,
  `np_reports`, and `np_bans`. `np_members` itself is
  still global (one identity, many tenants).

These aren't blockers. The shipped surface is enough to run
a real community site; each item above becomes obvious only
when traffic patterns surface a specific need.
