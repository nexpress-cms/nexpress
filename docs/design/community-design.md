# Member system + community — design

> ⚠️ **Frozen design snapshot.** This document captures the planning
> phase for the community / member system. The implementation has
> evolved since; for current behavior, read the code and the live
> guide at `docs/community.md`. Use this file as historical
> motivation only.
>
> Last verified against: 3ee45df (2026-04-30) — sections describing
> high-level rationale (member vs staff split, role topology) still
> match implementation. Specific schema / API field names may have
> drifted.

> Status: **draft** — first pass, soliciting feedback on the open decisions
> at the bottom of this doc before any code lands. Nothing here is built
> yet.

NexPress today is a single-tenant CMS with **staff** users (admin, editor,
author, viewer) who manage content. This design extends it with two
adjacent surfaces:

1. **Member system** — public site visitors who can register, log in, and
   maintain a profile. Members are *not* CMS staff and never get admin
   access.
2. **Community** — comments on collection documents, freestanding
   discussion threads, reactions, follows, notifications, and the
   moderation tooling needed to keep the lights on.

Goals:

- A clean separation between CMS staff and site members. Two tables, two
  auth flows, two cookie families. A bug in one path can't escalate the
  other.
- Reuse as much existing machinery as possible (JWT signer, Argon2,
  rate limiter, email adapter, observability hooks) so we don't grow a
  parallel auth/session/notification stack.
- Community primitives (comments, threads, reactions) are dedicated
  tables, not user-defined collections — they're polymorphic and the
  generated-collections pipeline doesn't fit polymorphism.
- Plugins extend community behavior (anti-spam, social login, profanity
  filter) via the same capability model as Phase 3.
- Moderation is a first-class staff role; it's never bolted on after a
  flame war.

Non-goals (deferred):

- Federated identity (ActivityPub / Matrix bridge).
- Real-time chat / presence.
- DMs / private messaging — possible later, intentionally out of scope
  for the first cut.
- Rich social graph features (mutual recommendations, suggested
  follows). Just plain follows.

---

## 1. Member identity

### Schema

```
np_members
  id              uuid pk
  handle          text unique not null         -- public, /u/{handle}
  email           text unique not null
  email_verified  bool default false
  password        text not null                -- argon2 (or null for SSO-only)
  display_name    text not null
  avatar          uuid → np_media (null)
  bio             text (null)
  status          enum('active','pending','suspended','deleted')
  reputation      int default 0
  login_attempts  int default 0
  lock_until      timestamptz (null)
  token_version   int default 0
  password_reset_token_hash  text (null)
  password_reset_expires_at  timestamptz (null)
  meta            jsonb default '{}'           -- plugin-extensible
  created_at      timestamptz default now()
  updated_at      timestamptz default now()

np_member_sessions
  id, member_id → np_members, token_hash, user_agent, ip, expires_at, created_at

np_member_identities                            -- SSO providers
  id, member_id → np_members
  provider        text                          -- 'google' | 'github' | 'oauth:custom-id'
  subject         text                          -- provider's user id
  email           text
  created_at
  unique(provider, subject)
```

Why a separate table from `np_users`:

- Different access policies. Members never get `role: "admin"` by
  accident — there's no role column at all on the member table.
- Different cookie families: `nx-mb-session` / `nx-mb-refresh` /
  `nx-mb-csrf`. Staff and member sessions can coexist in the same
  browser; visiting `/admin` while logged in as a member doesn't
  leak anything.
- Different rate-limit buckets at the middleware level (registration
  abuse should not affect staff login).
- Operationally cleaner: a `DELETE FROM np_users` doesn't take down
  the public site's comment authors.

### Auth flow

| Step | Endpoint | Notes |
|---|---|---|
| Register | `POST /api/members/register` | Sends verification email; member starts as `status: pending` until verified. |
| Verify email | `POST /api/members/verify` | Token from email; flips `email_verified` + `status: active`. |
| Login | `POST /api/members/login` | Same Argon2 + JWT machinery; sets `np-mb-*` cookies. |
| Refresh | `POST /api/members/refresh` | Rotates session JWT. |
| Forgot / reset | `POST /api/members/forgot-password`, `POST /api/members/reset-password` | Reuses the email adapter from PR #22. |
| Logout | `POST /api/members/logout` | Clears cookies + revokes session row. |
| Me | `GET /api/members/me` | Returns the public profile + private fields the member can see. |
| Update profile | `PATCH /api/members/me` | Editable fields: display_name, bio, avatar, password. Email change requires re-verification. |
| Delete | `DELETE /api/members/me` | Soft-delete (sets `status: deleted`, anonymises content). |

JWT shape mirrors staff sessions but adds an `aud: "member"` claim so
middleware can route correctly:

```ts
{ sub: memberId, aud: "member", ver: tokenVersion, iat, exp }
```

`requireMember(request)` is the new helper, separate from `requireAuth`
(which keeps targeting staff). Routes that accept either should call a
new `requirePrincipal(request, ["staff", "member"])` to be explicit.

### Scoped roles (member-side)

Sites grow into a "category X has its own moderator" pattern long before
they need full staff seats. Putting `role` directly on the member table
forces a one-role-per-member ceiling and makes scoping awkward later, so
permissions live in a polymorphic grants table:

```
np_member_roles
  id           uuid pk
  member_id    uuid → np_members not null
  role         text not null              -- 'community-mod', 'category-mod',
                                          --  'collection-mod', 'thread-author', …
  scope_type   text not null              -- 'site' | 'category' | 'collection' | 'thread'
  scope_id     text                       -- null when scope_type='site'
  granted_by   uuid → np_users (null)     -- staff who promoted (null for system grants)
  granted_at   timestamptz default now()
  expires_at   timestamptz (null)         -- temporary mods, time-boxed promotions
  unique (member_id, role, scope_type, scope_id)
  index (scope_type, scope_id)            -- "who mods this category?"
  index (member_id)                       -- "what can this member do?"
```

#### Built-in roles

| `role` | Typical scope | Capabilities |
|---|---|---|
| `community-mod` | `site` | Hide / restore any community content site-wide. Resolve any report. Ban members. Equivalent to a staff `moderator`, but earned/granted to a member without making them staff. |
| `category-mod` | `category` | Same as `community-mod`, restricted to threads + replies inside one `np_thread_categories.id`. |
| `collection-mod` | `collection` (slug) | Same, restricted to comments on documents in one collection (e.g. mod the comments under `posts/*` only). |
| `thread-author` | `thread` | Edit thread title/body, lock/unlock the thread. Auto-granted on create, never manually. |

The list is **extensible**: plugins can register additional `(role,
scope_type)` pairs (e.g. `tag-mod` scoped to a tag) via a new
`registerCommunityRole(...)` API. Capabilities map to a permission
matrix the host owns; plugins declare what their role can do, but the
permission *check* is run by the host.

#### How grants are created

- **By staff** — admin/editor/moderator opens a member's profile,
  picks a role + scope (with type-aware scope picker), commits. Audit
  trail logs to `np_audit` (covered in Phase 9.5).
- **By the system** — `thread-author` auto-grants on `np_threads`
  insert; revokes on delete.
- **By plugins** — a reputation plugin can auto-grant `community-mod`
  when `np_members.reputation` crosses a threshold. Requires the
  plugin to declare a `members:write` capability.

#### Permission check

The single entry point is `memberCan(memberId, action, target)`. It
walks the grant set in this order:

1. Is the member banned from this scope? (see `np_bans` below) → deny.
2. Is the member the owner of the target *and* is `action` an
   own-content action like `edit-own`? → allow.
3. Walk grants matching `target`'s scope chain:
   - For a reply targeting thread T in category C: check grants for
     the reply itself, then thread T (`scope_type='thread'`), then
     category C, then site-wide. The first matching role whose
     capability set includes `action` wins.
4. No match → deny.

Action vocabulary (initial cut): `hide-comment`, `restore-comment`,
`hide-thread`, `lock-thread`, `pin-thread`, `ban-member`,
`resolve-report`, `delete-any-comment`, `delete-any-thread`,
`edit-any-comment`, `manage-category`, `view-staff-tools`.

Each role's capability set is declared in code (in `community/roles.ts`)
so the permission matrix is reviewable in one diff. Plugins extend it
via `registerCommunityRole({ role, scopeType, capabilities, …})`.

#### Bans get scoped too

Updated ban schema (replaces the simple version in §2):

```
np_bans
  id, member_id → np_members
  scope_type    text not null    -- 'site' | 'category' | 'collection'
  scope_id      text             -- null for site-wide
  kind          enum('temporary','permanent')
  expires_at    timestamptz (null)
  reason        text, by_user_id → np_users (or null when by_member_id set)
  by_member_id  uuid → np_members (null)  -- when a category-mod issues the ban
  created_at
  index (member_id, scope_type, scope_id)
```

A category-mod can ban a member only from their own category; a
community-mod / staff moderator can issue site-wide bans. The grant
check above gates which kinds of bans a given principal can issue.

#### Staff-side stays simple

Staff users (`np_users`) keep their existing global roles
(`admin/editor/author/viewer`). We add `moderator` to the enum (already
proposed). Staff users do **not** use `np_member_roles` — staff is
always site-wide. The permission resolver checks the staff path first
(if the request principal is a staff user) before falling back to
member grants.

This split matches operational reality: staff is the small ops team
that gets full trust, members are the larger pool where some are
elevated to scoped trust by either staff promotion or system rules.

### Settings (admin-controlled)

```ts
community: {
  registration: "open" | "invite-only" | "disabled",
  requireEmailVerification: boolean,
  defaultMemberStatus: "active" | "pending",
  blockedEmailDomains: string[],          // simple regex list
  honeypotField: boolean,                 // adds a hidden field to the registration form
  passwordPolicy: { minLength: number, requireMixedCase?: boolean },
}
```

Stored under `np_settings.key = "community"`, edited via a new
**Community settings** page in the admin.

---

## 2. Community primitives

### Schema

#### Comments

```
np_comments
  id             uuid pk
  target_type    text not null            -- collection slug, e.g. "posts"
  target_id      uuid not null            -- doc id
  parent_id      uuid → np_comments (null) -- top-level when null
  member_id      uuid → np_members not null
  body_md        text not null            -- markdown source
  body_html      text not null            -- sanitised, server-rendered
  status         enum('visible','pending','hidden','deleted')
  hidden_by      uuid → np_users (null)   -- staff who hid it
  hidden_reason  text (null)
  edited_at      timestamptz (null)
  created_at     timestamptz default now()
  index (target_type, target_id, created_at)
  index (member_id, created_at)
```

#### Forum / threads — **as a collection + plugin, not a dedicated subsystem**

The original draft proposed `np_threads` / `np_thread_categories` /
`np_thread_replies` as separate tables. We dropped that — collections
already give us typed tables, drafts/publish, search, slugs, admin UI,
and `community.comments=true` already provides `parent_id`-threaded
replies via `np_comments`. Re-implementing those as parallel tables
would have been duplication.

The replacement is the built-in **`@nexpress/plugin-forum`** package:

```ts
// nexpress.config.ts
import { defineDiscussionsCollection, forumPlugin } from "@nexpress/plugin-forum";

const discussions = defineDiscussionsCollection({
  categories: [
    { label: "General", value: "general" },
    { label: "Announcements", value: "announcements" },
  ],
});

export default defineConfig({
  collections: [postsCollection, pagesCollection, discussions],
  plugins: [forumPlugin],
});
```

`pnpm db:generate && pnpm db:migrate` adds `np_c_discussions`. Members
comment under each discussion via the existing `/api/collections/
discussions/{id}/comments` endpoint; reactions and follow-the-thread
all come for free from 9.2 + 9.3.

**Operating model** (v1): staff curates discussions (announcements,
topics, Q&A prompts); members converse in the comment system.
Member-authored top-level threads (Reddit-style) require a
"member-writable collection" path that doesn't exist yet — when it
lands, the plugin's collection definition flips `access.create` from
`isEditorOrAbove` to "any active member" without a schema change.

`thread-author` capability and the `thread` scope on
`np_member_roles` remain in the schema but go unused until member-
writable collections ship — the registry is forward-compatible.

#### Reactions (polymorphic)

```
np_reactions
  id           uuid pk
  target_type  text not null     -- 'comment' | 'thread' | 'reply'
  target_id    uuid not null
  member_id    uuid → np_members not null
  kind         text not null     -- 'like' | 'helpful' | 'celebrate' | …
  created_at   timestamptz default now()
  unique (target_type, target_id, member_id, kind)
  index (target_type, target_id)
```

`kind` is configurable per site; default is just `like`. Vote-like
behaviors (upvote/downvote) are modeled as two distinct kinds rather
than a bipolar `value: -1 | 1` column so reaction analytics can pivot
freely.

#### Follows + notifications

```
np_follows
  id, follower_id → np_members, target_type ('member' | 'thread' | 'tag'), target_id text
  unique (follower_id, target_type, target_id)

np_notifications
  id, member_id → np_members
  kind          text             -- 'comment.reply' | 'reaction.received' | …
  payload       jsonb            -- target ids + summary fields
  read_at       timestamptz (null)
  created_at    timestamptz default now()
  index (member_id, read_at, created_at)
```

#### Reports + bans

```
np_reports
  id, reporter_id → np_members, target_type, target_id, reason text, body text
  resolved_at    timestamptz (null), resolved_by → np_users, resolution text
  created_at
  index (resolved_at, created_at)

(see the scoped `np_bans` schema in §1.4 — the simple version originally
sketched here is replaced.)
```

A staff `moderator` role is added to `np_user_role` enum (alongside
admin, editor, author, viewer) and gates the moderation UI without
giving full admin powers. Members can also hold scoped moderation
authority via `np_member_roles` — see §1.4.

### API surface

- Public read:
  - `GET /api/comments?targetType=posts&targetId={id}` — paged comments + reactions
  - `GET /api/threads`, `GET /api/threads/{slug}`, `GET /api/threads/{slug}/replies`
  - `GET /api/members/{handle}` — public profile (no email, no internal fields)
- Member-authenticated:
  - `POST /api/comments`, `PATCH /api/comments/{id}`, `DELETE /api/comments/{id}` (own only)
  - `POST /api/threads`, `POST /api/threads/{slug}/replies`
  - `POST /api/reactions` (polymorphic), `DELETE /api/reactions/{id}`
  - `POST /api/follows`, `DELETE /api/follows/{id}`
  - `GET /api/notifications` (own), `POST /api/notifications/mark-read`
  - `POST /api/reports` — file a report
- Staff-authenticated (moderator+):
  - `GET /api/admin/community/reports`, `POST .../resolve`
  - `POST /api/admin/community/comments/{id}/hide` / `/restore`
  - `POST /api/admin/members/{id}/ban`, `/unban`
- Settings:
  - `GET|PATCH /api/settings/community`

All write endpoints CSRF-protected. Per-member quotas (configurable,
e.g. 10 comments/min, 100 reactions/min) sit alongside the existing
per-IP middleware buckets.

### Notifications pipeline

`content:afterCreate` on `np_comments` (or directly inside the comment
service) enqueues:

- For top-level comment on a doc → notify all members following that doc/tag.
- For reply to comment → notify the parent comment's author.
- For reaction → batch-notify the target's author (debounced by minute).

Notifications write to `np_notifications` synchronously and enqueue a
pg-boss `notification:email` job that the worker picks up and routes
through the email adapter (respecting per-member email-frequency
preferences in `meta`).

---

## 3. Admin / moderation UX

New admin sections (gated by `moderator` role or higher):

- **Members** — list, filter by status, ban/unban, view recent
  activity, force email re-verify, force password reset.
- **Community → Reports** — paged queue of unresolved reports with
  per-target preview + "hide" / "dismiss" / "ban author" actions.
- **Discussions list** — once `@nexpress/plugin-forum` is enabled,
  the `discussions` collection appears in the standard collection
  list view with `pinned` / `locked` / `status` columns. No bespoke
  table is needed.
- **Community → Settings** — registration policy, allowed reaction
  kinds, default category for new threads, email/notification
  defaults.
- **Each existing collection edit page** gains a **Comments** tab
  (via the existing `collectionTabs` plugin extension point — feels
  natural to ship the comments tab as a built-in non-plugin
  extension, but the plumbing is identical).

---

## 4. Plugin extension points

Community shouldn't reinvent the plugin model. New capabilities:

- `members:read`, `members:write` — read/manipulate member records.
- `community:read`, `community:write`, `community:moderate` — same
  shape as `content:*`.
- `hooks:community` — subscribes to `community:beforeComment`,
  `community:afterReaction`, etc.

Plugin-extensible touchpoints:

- **Anti-spam adapter** — `setSpamAdapter({ check(text, member) → 'pass' | 'flag' | 'reject' })`.
- **Profanity filter** — same adapter pattern; runs on comment + thread bodies pre-write.
- **SSO adapter** — `registerOAuthProvider({ id, authorize, exchange })` so a plugin can add Google/GitHub login without forking the auth helpers.
- **Reputation rules** — pluggable computation for the `reputation` int (votes, comment count, etc.).

---

## 5. Phasing

The whole thing is too big to ship in one PR. Suggested order:

| Phase | Slice | Includes |
|---|---|---|
| **9.1** | Member identity | `np_members`, `np_member_sessions`, `np_member_roles` (table + permission resolver), member auth helpers, registration + login + me + reset, public profile read, /u/{handle} route, admin Members list (no moderation actions yet — but `memberCan()` lands here so 9.2+ can call it from day one). |
| **9.2** | Comments on existing collections | `np_comments`, list/post/edit/delete API, render under each `(site)` post page, comments tab in admin edit view, basic hide action, `collection-mod` capability matrix wired (so a member promoted in 9.1 can hide comments on `posts` from day one). |
| **9.3** | Reactions + follows + notifications | `np_reactions`, `np_follows`, `np_notifications`, mark-read API, in-admin notification preview. |
| **9.4** | Forum (built-in plugin) | `@nexpress/plugin-forum` package: `defineDiscussionsCollection({ slug, categories })` returns a ready-to-spread collection config; `forumPlugin` exposes a discussions stats dashboard widget. apps/web demo registers a `discussions` collection. **No new community-only tables** — comments, reactions, follows all come from 9.2/9.3. Member-authored top-level threads (Reddit-style) await a separate "member-writable collections" feature. |
| **9.5** | Moderation | `np_reports`, `np_bans` (scoped), staff `moderator` role, member role grant UI (promote member → category-mod, etc.), reports queue UI, ban flow, audit trail. |
| **9.6** | Pluggable bits | SSO adapter, anti-spam adapter, reputation rules, community settings page. |

Each slice ships with integration tests and OpenAPI updates the same
way Phases 1–8 did.

---

## 6. Decisions — recorded for the record

Each item below has a **working default** that we'll build to. Decisions
that turn out wrong can still be reversed at the boundary of a phase
(9.1 → 9.2, etc.) — the cost grows fast once tables are populated, so
each phase's PR description should re-raise any of these the
implementation surfaces as questionable.

1. **Separate `np_members` table vs. extending `np_users` with a
   `kind` column.** Draft picks separate. Argument for extending: one
   auth path, one session table, simpler. Argument for separate (this
   draft): cleaner role isolation, smaller blast radius on bugs,
   operationally cleaner backups/exports. Note: even with the separate
   table, scoped moderator roles are addressed via `np_member_roles`
   grants (§1.4) — promoting a member to a category mod doesn't
   require making them staff.

2. **Polymorphic comments table** (`target_type`, `target_id` referencing
   any collection) **vs. per-collection comment tables** generated by the
   collections pipeline. Draft picks polymorphic. Argument for
   per-collection: type-safe joins, drizzle relations work natively,
   cascades on doc delete are FK-clean. Argument for polymorphic: one
   table to query, comments-on-anything works with no codegen step.

3. **Reply nesting depth.** Draft picks "one level visual, though
   `parent_reply_id` allows arbitrary chains internally." Alternatives:
   true flat (no parent), arbitrary tree (Reddit-style).

4. **Default reaction kinds.** Draft is just `like`. Q&A sites need
   `helpful`/`unhelpful`; news sites might want `celebrate`/`sad`/
   `angry`. Options: single hardcoded set, configurable per
   collection, configurable per site.

5. **Email verification default.** Draft picks "required, member
   starts `pending`." Alternatives: optional with a banner, deferred
   verification (X days grace).

6. **Markdown vs. rich text for comment bodies.** Draft picks
   markdown (server-rendered, sanitized). Alternatives: a stripped
   Lexical editor, plain text only.

7. **Forum subsystem.** Resolved: **dropped as a dedicated
   subsystem**, replaced by `@nexpress/plugin-forum` shipping a
   collection scaffold. Comments + replies + reactions + follows
   from 9.2/9.3 carry the threading + voting load — re-implementing
   them as `np_threads*` was duplication. Member-authored top-level
   threads remain a separate framework feature (member-writable
   collections); the plugin's `access.create` flips when that lands.

8. **Notification email delivery cadence.** Per-event vs. digest
   (hourly / daily). Draft assumes per-event; digest can come later.

9. **Member account deletion** — soft (anonymise content, keep ids
   for FK integrity) vs. hard (cascade delete comments / threads).
   Draft picks soft (anonymise display_name, scrub email, set
   `status: deleted`).

10. **Two cookie families** — draft picks `np-mb-*` for members vs.
    `np-` for staff. Alternative: single cookie with `aud` claim.
    Two families is more bytes per request but bug-isolation wins.

11. **Scoped role granularity.** Resolved: ship four built-in roles
    (`community-mod`, `category-mod`, `collection-mod`,
    `thread-author`). `collection-mod` ships **in Phase 9.2 alongside
    comments** so per-collection moderation works from the moment
    comments exist (don't make ops wait until 9.5). Time-boxed
    grants (`expires_at`) remain in the schema from 9.1 but the
    grant-management UI defers — staff revoke manually until the
    UI ships. Plugin-defined roles via
    `registerCommunityRole(...)` are available from 9.1.

---

## 7. Appendix: what gets reused as-is

To keep scope honest, here's what we already have that the design
leverages without rewriting:

- **Argon2 password hashing** (`@nexpress/core` `auth/password.ts`)
- **JWT signer/verifier** (`auth/token.ts`) — just needs a new `aud` claim path
- **Email adapter** (PR #22) — every member email goes through it
- **Job queue** (pg-boss) — notification fan-out lives here
- **Rate limit middleware** — extended with new buckets, not replaced
- **Observability hooks** (PR #33) — every community write goes through `getLogger()` / `reportError()`
- **OpenAPI auto-generation** — every new route gets documented automatically
- **Capability model** — new caps slot into the existing manifest schema
- **Revisions table** — could be reused for comment edit history if we want to track diffs
