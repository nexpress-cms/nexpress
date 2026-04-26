import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { nxMedia } from "./media.js";
import { nxUsers } from "./system.js";

/**
 * Member-side schema: public site visitors who can register, log in,
 * comment, react, follow, etc. Deliberately separate from `nx_users`
 * (CMS staff) — separate cookie family, separate JWT audience, no
 * `role` column on the member table itself. Scoped moderator authority
 * is granted via `nx_member_roles` instead. See `docs/community-design.md`.
 */

export const nxMemberStatusEnum = pgEnum("nx_member_status", [
  "active",
  "pending",
  "suspended",
  "deleted",
]);

export const nxBanScopeEnum = pgEnum("nx_ban_scope", ["site", "category", "collection"]);
export const nxBanKindEnum = pgEnum("nx_ban_kind", ["temporary", "permanent"]);

/**
 * Comment lifecycle status.
 *  - `visible` — public.
 *  - `pending` — awaiting moderation (reserved; not used yet in 9.2).
 *  - `hidden` — taken down by a mod; row stays for restore + audit.
 *  - `deleted` — soft-delete by the author or post-cascade.
 */
export const nxCommentStatusEnum = pgEnum("nx_comment_status", [
  "visible",
  "pending",
  "hidden",
  "deleted",
]);

/**
 * Type column for `nx_member_roles.scope_type`. Polymorphic across the
 * community surface so the same grants table covers site-wide,
 * per-category, per-collection, and per-thread roles.
 */
export const nxMemberRoleScopeEnum = pgEnum("nx_member_role_scope", [
  "site",
  "category",
  "collection",
  "thread",
]);

export const nxMembers = pgTable(
  "nx_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    handle: text("handle").notNull().unique(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    /** Argon2 hash. Nullable so SSO-only members can exist without a password. */
    password: text("password"),
    displayName: text("display_name").notNull(),
    avatar: uuid("avatar").references((): AnyPgColumn => nxMedia.id),
    bio: text("bio"),
    status: nxMemberStatusEnum("status").default("pending").notNull(),
    reputation: integer("reputation").default(0).notNull(),
    loginAttempts: integer("login_attempts").default(0).notNull(),
    lockUntil: timestamp("lock_until", { withTimezone: true, mode: "date" }),
    /** Bumped to invalidate every issued JWT (logout-everywhere, password reset). */
    tokenVersion: integer("token_version").default(0).notNull(),
    passwordResetTokenHash: text("password_reset_token_hash"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    emailVerifyTokenHash: text("email_verify_token_hash"),
    emailVerifyExpiresAt: timestamp("email_verify_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    /** Plugin-extensible bag — preferences, custom profile fields, etc. */
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("nx_members_status_idx").on(table.status)],
);

export const nxMemberSessions = pgTable("nx_member_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => nxMembers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

/**
 * Per-member OAuth identity links. Mirrors `nx_user_oauth_identities`
 * for the staff side (Phase 9.6a) but resolves to `nx_members`
 * instead of `nx_users`. The first row is created either when an
 * OAuth callback finds an existing member with the same email, or
 * when a brand-new member is auto-provisioned from the profile
 * (status=`active`, no password).
 *
 * `subject` is the provider's stable user id (GitHub `id`, Google
 * `sub`, etc.) — naming kept from the 9.1 placeholder schema for
 * backward compat. The staff equivalent calls the same column
 * `provider_user_id`; both serve the same role.
 */
export const nxMemberIdentities = pgTable(
  "nx_member_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    /** Free-form per-provider metadata (avatar URL, scopes granted, etc.). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("nx_member_identities_provider_subject_uq").on(table.provider, table.subject),
    unique("nx_member_identities_member_provider_uq").on(table.memberId, table.provider),
    index("nx_member_identities_member_idx").on(table.memberId),
  ],
);

/**
 * Polymorphic role grants. A member with a row here can act as that
 * role within the indicated scope. `scope_id` is null when
 * `scope_type='site'`. The `(member, role, scope_type, scope_id)`
 * uniqueness keeps grants idempotent; `expires_at` is honored by
 * `memberCan()` so time-boxed promotions are possible.
 */
export const nxMemberRoles = pgTable(
  "nx_member_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    scopeType: nxMemberRoleScopeEnum("scope_type").notNull(),
    /** Nullable for `scope_type='site'`. Otherwise an opaque string id. */
    scopeId: text("scope_id"),
    grantedBy: uuid("granted_by").references(() => nxUsers.id),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    // Two indexes mirror the two access patterns: "what can this member
    // do?" (memberId scan) and "who mods this scope?" (scope scan).
    index("nx_member_roles_member_idx").on(table.memberId),
    index("nx_member_roles_scope_idx").on(table.scopeType, table.scopeId),
    // `scope_id` is null for site-wide grants. Postgres treats NULL as
    // distinct from NULL in a unique constraint by default, which would
    // let a member be granted `community-mod` (site) twice. NULLS NOT
    // DISTINCT (Postgres 15+) makes the two NULL rows collide so the
    // unique constraint actually enforces "one grant per (member, role,
    // scope)" the way the design intends.
    unique("nx_member_roles_grant_uq")
      .on(table.memberId, table.role, table.scopeType, table.scopeId)
      .nullsNotDistinct(),
  ],
);

/**
 * Member bans. Scoped: a category-mod can ban a member from their
 * category only; a `community-mod` or staff `moderator` can issue
 * site-wide bans. `memberCan()` short-circuits to deny when an active
 * (unexpired) ban matches the action's target scope chain.
 *
 * `byUserId` records the staff issuer; `byMemberId` records when a
 * member-mod (e.g. category-mod) issued the ban. Exactly one is set.
 */
/**
 * Polymorphic comment table — `target_type` is the collection slug
 * (e.g. `"posts"`), `target_id` the document id within that
 * collection. One row per comment regardless of which collection it
 * lives under, indexed for the typical "list comments under doc X"
 * read.
 *
 * Bodies are stored twice: `body_md` is the canonical user input,
 * `body_html` is the rendered + sanitised HTML the renderer ships
 * to browsers. We re-render on edit; we never trust the html column
 * to be HTML-safe based on incoming requests — see
 * `community/markdown.ts` for the renderer.
 */
export const nxComments = pgTable(
  "nx_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => nxComments.id, {
      onDelete: "cascade",
    }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    bodyMd: text("body_md").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: nxCommentStatusEnum("status").default("visible").notNull(),
    hiddenByUserId: uuid("hidden_by_user_id").references(() => nxUsers.id),
    hiddenByMemberId: uuid("hidden_by_member_id").references(
      (): AnyPgColumn => nxMembers.id,
    ),
    hiddenReason: text("hidden_reason"),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_comments_target_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index("nx_comments_member_idx").on(table.memberId, table.createdAt),
  ],
);

/**
 * Polymorphic reactions. `target_type` is the surface (`'comment'` for
 * 9.3; `'thread'` / `'reply'` land alongside the forum tables in 9.4).
 * `kind` is configurable per site — default vocabulary in v1 is just
 * `'like'`. The unique constraint enforces "one reaction-of-kind per
 * member per target," so toggling a like is an upsert / delete.
 */
export const nxReactions = pgTable(
  "nx_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_reactions_target_idx").on(table.targetType, table.targetId),
    unique("nx_reactions_unique").on(
      table.targetType,
      table.targetId,
      table.memberId,
      table.kind,
    ),
  ],
);

/**
 * Follow graph. Polymorphic over what's being followed:
 *  - `member` — target_id is `nx_members.id` as a string
 *  - `thread` — target_id is `nx_threads.id` (lands in 9.4)
 *  - `tag`    — target_id is the tag slug (no FK; tags are strings)
 *
 * `target_id` is `text` rather than `uuid` so all three kinds share
 * one column. Cascading on a polymorphic id isn't possible in plain
 * SQL; the soft-delete pattern on `nx_members` keeps follows pointing
 * at a still-valid (if anonymised) row.
 */
export const nxFollows = pgTable(
  "nx_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_follows_target_idx").on(table.targetType, table.targetId),
    unique("nx_follows_unique").on(table.followerId, table.targetType, table.targetId),
  ],
);

/**
 * Per-member notification inbox. `kind` is a free-form discriminator
 * (e.g. `'comment.reply'`, `'reaction.received'`, `'follow.received'`)
 * paired with a `payload` whose shape depends on the kind — the
 * recipient's UI renders based on those.
 *
 * Indexed on `(member_id, read_at, created_at)` to cover both the
 * unread-count probe and the recent-list paging that an inbox UI uses.
 */
export const nxNotifications = pgTable(
  "nx_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_notifications_inbox_idx").on(
      table.memberId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

/**
 * Member-filed reports against community content. `target_type` is
 * `'comment' | 'thread' | 'reply' | 'member'` — anything a member can
 * report. `resolved_at` flags closed cases; the unresolved index
 * powers the moderation queue's "unread first" view.
 *
 * `resolved_by_user_id` and `resolved_by_member_id` are mutually
 * exclusive — staff resolutions populate the user, member-mod
 * resolutions populate the member.
 */
export const nxReports = pgTable(
  "nx_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => nxUsers.id),
    resolvedByMemberId: uuid("resolved_by_member_id").references(
      (): AnyPgColumn => nxMembers.id,
    ),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_reports_queue_idx").on(table.resolvedAt, table.createdAt),
    index("nx_reports_target_idx").on(table.targetType, table.targetId),
  ],
);

/**
 * Append-only moderation audit log. Every hide / restore / ban / role
 * grant write should append a row so an admin can answer "who took
 * this action and when?" without diffing logs.
 *
 * `actor_kind` distinguishes staff / member-mod / system writes
 * (e.g. an automated revocation when a member soft-deletes their
 * account). `target_id` is `text` because some actions target string
 * ids — like `"posts"` for a `collection-mod` grant scope.
 */
export const nxAuditEvents = pgTable(
  "nx_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorKind: text("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => nxUsers.id),
    actorMemberId: uuid("actor_member_id").references(
      (): AnyPgColumn => nxMembers.id,
    ),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_audit_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("nx_audit_actor_user_idx").on(table.actorUserId, table.createdAt),
    index("nx_audit_actor_member_idx").on(table.actorMemberId, table.createdAt),
  ],
);

export const nxBans = pgTable(
  "nx_bans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => nxMembers.id, { onDelete: "cascade" }),
    scopeType: nxBanScopeEnum("scope_type").notNull(),
    scopeId: text("scope_id"),
    kind: nxBanKindEnum("kind").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    byUserId: uuid("by_user_id").references(() => nxUsers.id),
    byMemberId: uuid("by_member_id").references((): AnyPgColumn => nxMembers.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("nx_bans_member_scope_idx").on(table.memberId, table.scopeType, table.scopeId),
    index("nx_bans_active_idx").on(table.memberId, table.expiresAt),
  ],
);
