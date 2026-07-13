import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { npMedia } from "./media.js";
import { npUsers } from "./system.js";
import { npMemberStatuses } from "../../auth-contract/types.js";

/**
 * Member-side schema: public site visitors who can register, log in,
 * comment, react, follow, etc. Deliberately separate from `np_users`
 * (CMS staff) — separate cookie family, separate JWT audience, no
 * `role` column on the member table itself. Scoped moderator authority
 * is granted via `np_member_roles` instead. See `docs/design/community-design.md` (frozen design rationale) or `docs/community.md` (live behavior).
 */

/**
 * Phase 21.7 — `imported` is a member created by the WordPress
 * importer to attribute archived guest comments. Imported members
 * cannot log in (no usable password set) and don't fire community
 * notifications when content tags them. Default themes render the
 * member's handle with an `(imported)` suffix so visitors can tell
 * archived discussion apart from live activity.
 */
export const npMemberStatusEnum = pgEnum("np_member_status", npMemberStatuses);

export const npBanScopeEnum = pgEnum("np_ban_scope", ["site", "category", "collection"]);
export const npBanKindEnum = pgEnum("np_ban_kind", ["temporary", "permanent"]);

/**
 * Comment lifecycle status.
 *  - `visible` — public.
 *  - `pending` — awaiting moderation. Used by the spam / profanity
 *    adapters when a verdict comes back as `flag` (9.7n).
 *  - `hidden` — taken down by a mod; row stays for restore + audit.
 *  - `deleted` — soft-delete by the author or post-cascade.
 */
export const npCommentStatusEnum = pgEnum("np_comment_status", [
  "visible",
  "pending",
  "hidden",
  "deleted",
]);

/**
 * Type column for `np_member_roles.scope_type`. Polymorphic across the
 * community surface so the same grants table covers site-wide,
 * per-category, per-collection, and per-thread roles.
 */
export const npMemberRoleScopeEnum = pgEnum("np_member_role_scope", [
  "site",
  "category",
  "collection",
  "thread",
]);

export const npMembers = pgTable(
  "np_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    handle: text("handle").notNull().unique(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    /** Argon2 hash. Nullable so SSO-only members can exist without a password. */
    password: text("password"),
    displayName: text("display_name").notNull(),
    avatar: uuid("avatar").references((): AnyPgColumn => npMedia.id),
    bio: text("bio"),
    status: npMemberStatusEnum("status").default("pending").notNull(),
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
    /**
     * Phase 16.3 — per-member notification preferences. Shape:
     *   { disabled?: string[] }   — kinds the member opted out of
     *   { digest?: "off"|"daily"|"weekly" }  — email digest cadence (16.4)
     * Empty default = every kind enabled, no email digest.
     */
    notificationPrefs: jsonb("notification_prefs")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("np_members_status_idx").on(table.status)],
);

export const npMemberSessions = pgTable(
  "np_member_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    accessTokenHash: text("access_token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true, mode: "date" }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_member_sessions_member_id_idx").on(table.memberId),
    index("np_member_sessions_refresh_expires_at_idx").on(table.refreshExpiresAt),
  ],
);

/**
 * Per-member OAuth identity links. Mirrors `np_user_oauth_identities`
 * for the staff side (Phase 9.6a) but resolves to `np_members`
 * instead of `np_users`. The first row is created either when an
 * OAuth callback finds an existing member with the same email, or
 * when a brand-new member is auto-provisioned from the profile
 * (status=`active`, no password).
 *
 * `subject` is the provider's stable user id (GitHub `id`, Google
 * `sub`, etc.) — naming kept from the 9.1 placeholder schema for
 * backward compat. The staff equivalent calls the same column
 * `provider_user_id`; both serve the same role.
 */
export const npMemberIdentities = pgTable(
  "np_member_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    /** Free-form per-provider metadata (avatar URL, scopes granted, etc.). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("np_member_identities_provider_subject_uq").on(table.provider, table.subject),
    unique("np_member_identities_member_provider_uq").on(table.memberId, table.provider),
    index("np_member_identities_member_idx").on(table.memberId),
  ],
);

/**
 * Polymorphic role grants. A member with a row here can act as that
 * role within the indicated scope. `scope_id` is null when
 * `scope_type='site'`. The `(member, role, scope_type, scope_id)`
 * uniqueness keeps grants idempotent; `expires_at` is honored by
 * `memberCan()` so time-boxed promotions are possible.
 */
export const npMemberRoles = pgTable(
  "np_member_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    scopeType: npMemberRoleScopeEnum("scope_type").notNull(),
    /** Nullable for `scope_type='site'`. Otherwise an opaque string id. */
    scopeId: text("scope_id"),
    /**
     * Phase 18 — the tenant the grant applies on. For
     * `scope_type='site'` this column IS the site identifier
     * (`scope_id` stays null because site is the root scope).
     * For category / collection / thread grants, `site_id` says
     * which tenant's category/collection/thread this row
     * targets — the same slug exists on every site.
     */
    siteId: text("site_id").default("default").notNull(),
    grantedBy: uuid("granted_by").references(() => npUsers.id),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    // Two indexes mirror the two access patterns: "what can this member
    // do?" (memberId scan) and "who mods this scope?" (scope scan).
    index("np_member_roles_member_idx").on(table.memberId),
    index("np_member_roles_scope_idx").on(table.scopeType, table.scopeId),
    index("np_member_roles_site_idx").on(table.siteId, table.memberId),
    // `scope_id` is null for site-wide grants. NULLS NOT
    // DISTINCT makes two null `scope_id`s collide so the
    // unique constraint enforces "one grant per (member, role,
    // scope, site)." `site_id` widens the key so the same
    // member can hold the same role on different tenants.
    unique("np_member_roles_grant_uq")
      .on(table.memberId, table.role, table.scopeType, table.scopeId, table.siteId)
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
export const npComments = pgTable(
  "np_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => npComments.id, {
      onDelete: "cascade",
    }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    bodyMd: text("body_md").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: npCommentStatusEnum("status").default("visible").notNull(),
    hiddenByUserId: uuid("hidden_by_user_id").references(() => npUsers.id),
    hiddenByMemberId: uuid("hidden_by_member_id").references((): AnyPgColumn => npMembers.id),
    hiddenReason: text("hidden_reason"),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    /**
     * Phase 18 — site this comment belongs to. Filled at insert
     * time from the target document's site (canonical) so a
     * forged request resolver can't smuggle a comment into the
     * wrong site. Defaults to `'default'` for legacy single-
     * tenant rows so the migration backfill is a no-op.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_comments_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("np_comments_member_idx").on(table.memberId, table.createdAt),
    index("np_comments_site_idx").on(table.siteId, table.createdAt),
  ],
);

/**
 * Polymorphic reactions. `target_type` is the surface — only
 * `'comment'` is wired today; `'thread'` / `'reply'` are reserved
 * for a future threads schema (the forum plugin shipped without
 * one, reusing `np_comments` under the `discussions` collection).
 * `kind` is configurable per site — default vocabulary in v1 is
 * just `'like'`. The unique constraint enforces "one reaction-of-
 * kind per member per target," so toggling a like is an upsert /
 * delete.
 */
export const npReactions = pgTable(
  "np_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Phase 18 — site this reaction belongs to (derived from target). */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_reactions_target_idx").on(table.targetType, table.targetId),
    index("np_reactions_site_idx").on(table.siteId),
    unique("np_reactions_unique").on(table.targetType, table.targetId, table.memberId, table.kind),
  ],
);

/**
 * Follow graph. Polymorphic over what's being followed:
 *  - `member` — target_id is `np_members.id` as a string
 *  - `thread` — reserved; no thread schema today (forum plugin
 *    reuses `np_comments` so there's nothing to follow per-thread)
 *  - `tag`    — target_id is the tag slug (no FK; tags are strings)
 *
 * `target_id` is `text` rather than `uuid` so all three kinds share
 * one column. Cascading on a polymorphic id isn't possible in plain
 * SQL; the soft-delete pattern on `np_members` keeps follows pointing
 * at a still-valid (if anonymised) row.
 */
export const npFollows = pgTable(
  "np_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /**
     * Phase 18 — site the follow happened on. The same global
     * member can follow on multiple sites and each row scopes
     * to where the click happened (so site-scoped notifications
     * + activity feeds don't leak cross-tenant). The unique
     * key is widened to include site_id so the same follower
     * can have parallel follow rows under different tenants.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_follows_target_idx").on(table.targetType, table.targetId),
    index("np_follows_site_idx").on(table.siteId),
    unique("np_follows_unique").on(
      table.followerId,
      table.targetType,
      table.targetId,
      table.siteId,
    ),
  ],
);

/**
 * Phase 16.1 — member-to-member mute. One-directional: A muting
 * B means A doesn't see B's comments and doesn't get
 * notifications about B's actions (replies, reactions, follows
 * targeted at A's content). B isn't told and can keep posting
 * normally — Twitter-style soft-block.
 *
 * Self-mute is rejected at the API layer. The composite PK on
 * `(memberId, targetId)` enforces idempotence: muting the same
 * person twice is a no-op rather than two rows.
 *
 * Distinct from `np_bans` — bans are staff-issued and global
 * (block writes). Mutes are member-issued and personal (hide
 * reads).
 */
export const npMemberMutes = pgTable(
  "np_member_mutes",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    /**
     * Phase 18 — site the mute applies to. A muter can choose
     * to silence someone on one tenant without affecting their
     * other tenants. PK is widened to include site_id so the
     * same `(member, target)` pair can hold parallel rows per
     * site.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.targetId, table.siteId] }),
    index("np_member_mutes_target_idx").on(table.targetId),
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
export const npNotifications = pgTable(
  "np_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    /**
     * Phase 18 — site this notification belongs to. A member
     * who's active on multiple tenants gets one inbox per site
     * (the inbox API filters by current site) so cross-tenant
     * activity doesn't bleed into the wrong site's UI.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_notifications_inbox_idx").on(table.memberId, table.readAt, table.createdAt),
    index("np_notifications_site_inbox_idx").on(table.siteId, table.memberId, table.readAt),
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
export const npReports = pgTable(
  "np_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => npUsers.id),
    resolvedByMemberId: uuid("resolved_by_member_id").references((): AnyPgColumn => npMembers.id),
    resolution: text("resolution"),
    /**
     * Phase 18 — site this report belongs to. The mod queue
     * is per-site so a category-mod on tenant A doesn't see
     * tenant B's reports.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_reports_queue_idx").on(table.resolvedAt, table.createdAt),
    index("np_reports_target_idx").on(table.targetType, table.targetId),
    index("np_reports_site_queue_idx").on(table.siteId, table.resolvedAt),
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
export const npAuditEvents = pgTable(
  "np_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorKind: text("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => npUsers.id),
    actorMemberId: uuid("actor_member_id").references((): AnyPgColumn => npMembers.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    /**
     * Phase 17 — site-scoped audit. Filled by `recordAuditEvent`
     * from the current request's site (the multi-site resolver).
     * Nullable for events that don't belong to a single site
     * (super-admin actions, background jobs, scripts).
     */
    siteId: text("site_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_audit_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("np_audit_actor_user_idx").on(table.actorUserId, table.createdAt),
    index("np_audit_actor_member_idx").on(table.actorMemberId, table.createdAt),
    index("np_audit_site_idx").on(table.siteId, table.createdAt),
  ],
);

export const npBans = pgTable(
  "np_bans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => npMembers.id, { onDelete: "cascade" }),
    scopeType: npBanScopeEnum("scope_type").notNull(),
    scopeId: text("scope_id"),
    kind: npBanKindEnum("kind").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    byUserId: uuid("by_user_id").references(() => npUsers.id),
    byMemberId: uuid("by_member_id").references((): AnyPgColumn => npMembers.id),
    /**
     * Phase 18 — the tenant this ban applies to. Pre-Phase 18
     * `scope_type='site'` rows had `scope_id=null` because
     * "site" was the singular root scope; with multi-tenancy
     * the column tells `assertNotBanned` WHICH site the ban
     * blocks writes on. Category / collection scopes resolve
     * per-site too — the same `posts` collection slug exists
     * on every tenant.
     */
    siteId: text("site_id").default("default").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_bans_member_scope_idx").on(table.memberId, table.scopeType, table.scopeId),
    index("np_bans_active_idx").on(table.memberId, table.expiresAt),
    index("np_bans_site_idx").on(table.siteId, table.memberId),
  ],
);
