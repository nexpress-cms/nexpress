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
import {
  type NpBlockInstance,
  type NpNavItem,
  type NpRichTextContent,
} from "../../config/types.js";

export const npUserRoleEnum = pgEnum("np_user_role", [
  "admin",
  "editor",
  // 9.5: community moderator. Sits OUTSIDE the linear content-edit
  // hierarchy — a moderator handles community moderation (hide
  // comments, resolve reports, issue bans) but cannot author or edit
  // collection content. ROLE_HIERARCHY in config/types.ts intentionally
  // does not list this role; community-moderation paths check the role
  // explicitly via `principalCan()`.
  "moderator",
  "author",
  "viewer",
]);

export const npRevisionStatusEnum = pgEnum("np_revision_status", [
  "draft",
  "published",
  "autosave",
]);

type NpRevisionSnapshot = Record<string, unknown> & {
  blocks?: NpBlockInstance[];
  content?: NpRichTextContent;
};

export const npPasswordResetPurposeEnum = pgEnum("np_password_reset_purpose", ["invite", "reset"]);

export const npUsers = pgTable("np_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: npUserRoleEnum("role").notNull(),
  /**
   * Phase 15.5 — super-admin flag. Bypasses per-site membership
   * checks; the super-admin can manage every site including
   * creating / deleting tenants. The flag is independent of
   * the per-site `role` enum (a super-admin still needs a
   * `role` field for non-multi-site contexts; multi-site
   * permissions check `is_super_admin OR site_membership`).
   */
  isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
  avatar: uuid("avatar").references((): AnyPgColumn => npMedia.id),
  loginAttempts: integer("login_attempts").default(0).notNull(),
  lockUntil: timestamp("lock_until", { withTimezone: true, mode: "date" }),
  tokenVersion: integer("token_version").default(0).notNull(),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  passwordResetPurpose: npPasswordResetPurposeEnum("password_reset_purpose"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * Phase 15.5 — per-site role grants. A user can hold a
 * different role on each site they're a member of (admin on
 * `acme`, editor on `partner-blog`, no role on `internal`).
 * Composite PK on (site_id, user_id) so each pair is unique;
 * the role enum reuses the existing `np_user_role` so the
 * concept stays consistent across the framework.
 *
 * `npUsers.role` becomes the "global default role" — used in
 * single-tenant contexts and as the fallback when a user has
 * no explicit membership on the current site. Most operators
 * will give cross-site users an explicit membership per
 * site they should access; the `is_super_admin` flag
 * separately bypasses the membership check entirely.
 */
export const npSiteMemberships = pgTable(
  "np_site_memberships",
  {
    siteId: text("site_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => npUsers.id, { onDelete: "cascade" }),
    role: npUserRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.userId] })],
);

/**
 * Per-user OAuth identity links. A user can have one identity per provider
 * (composite unique on `(provider, providerUserId)` AND on `(userId,
 * provider)`). The first identity is created either when the OAuth
 * callback finds an existing user with the same email, or when a brand-
 * new user is auto-created from the OAuth profile (default role
 * `viewer`).
 */
export const npUserOAuthIdentities = pgTable(
  "np_user_oauth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => npUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    /** Free-form per-provider metadata (avatar URL, scopes granted, etc.). */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    providerSubjectUnique: unique("np_user_oauth_identities_provider_subject_unique").on(
      table.provider,
      table.providerUserId,
    ),
    userProviderUnique: unique("np_user_oauth_identities_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
    userIdx: index("np_user_oauth_identities_user_idx").on(table.userId),
  }),
);

export const npSessions = pgTable("np_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => npUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

export const npRevisions = pgTable(
  "np_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    status: npRevisionStatusEnum("status").notNull(),
    snapshot: jsonb("snapshot").$type<NpRevisionSnapshot>().notNull(),
    changedFields: text("changed_fields").array().notNull(),
    authorId: uuid("author_id").references(() => npUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    documentVersionUnique: unique("np_revisions_document_id_version_unique").on(
      table.documentId,
      table.version,
    ),
    collectionIdx: index("np_revisions_collection_idx").on(table.collection),
    documentIdIdx: index("np_revisions_document_id_idx").on(table.documentId),
  }),
);

/**
 * Phase 15.4 — settings are scoped per site so each tenant
 * has its own active theme, theme tokens, SEO config, etc.
 * Single-tenant deployments leave every row at
 * `site_id = 'default'`, matching the framework's
 * default-site invariant. Composite PK on (site_id, key) so
 * the same key (e.g. `activeTheme`) can take different
 * values per tenant.
 */
export const npSettings = pgTable(
  "np_settings",
  {
    siteId: text("site_id").default("default").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => npUsers.id),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.key] })],
);

/**
 * Slug history for collections that declare `slugField`. Every
 * slug change writes a row mapping the previous slug to the
 * current one; the public-site catch-all reads it on 404 and
 * 301-redirects so old URLs (search-engine indices, external
 * links, bookmarks) keep working after a rename.
 *
 * Indexed by `(site_id, collection, old_slug)` because the read
 * path is "I just got a 404 for this slug, where did it go?" —
 * point lookups on that triple. Multiple rows can share the same
 * `(site_id, collection, document_id)` over time as a doc gets
 * renamed repeatedly; the catch-all walks the chain `oldSlug →
 * newSlug` to resolve to the current target.
 */
export const npSlugHistory = pgTable(
  "np_slug_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").default("default").notNull(),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    oldSlug: text("old_slug").notNull(),
    newSlug: text("new_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("np_slug_history_lookup_idx").on(table.siteId, table.collection, table.oldSlug),
    index("np_slug_history_doc_idx").on(table.siteId, table.collection, table.documentId),
  ],
);

/**
 * Phase 15.4 — navigation is scoped per site too. Same model
 * as settings: composite uniqueness on (site_id, location)
 * lets each tenant own its own header / footer menus.
 */
export const npNavigation = pgTable(
  "np_navigation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").default("default").notNull(),
    location: text("location").notNull(),
    items: jsonb("items").$type<NpNavItem[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => npUsers.id),
  },
  (table) => [unique("np_navigation_site_location_idx").on(table.siteId, table.location)],
);

/**
 * Phase D — UI string admin overrides. Plugins and themes
 * register translation bundles via `addStrings()` (Phase 12.5);
 * admins layer overrides on top via this table without
 * touching plugin/theme code. Composite PK on
 * (site_id, locale, key) makes per-tenant overrides natural —
 * "acme" and "default" can each override the same plugin's
 * "Read more" string differently.
 *
 * `value` is nullable so an admin can explicitly mark a key
 * as "fall back to bundle" without deleting the row (useful
 * for audit-trail UIs that want to show "this WAS overridden
 * but the operator reverted it"). The runtime treats null
 * the same as no row for resolution purposes.
 */
export const npStringOverrides = pgTable(
  "np_string_overrides",
  {
    siteId: text("site_id").default("default").notNull(),
    locale: text("locale").notNull(),
    key: text("key").notNull(),
    value: text("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => npUsers.id),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.locale, table.key] })],
);

/**
 * Phase 15.1 — multi-site model. One row per tenant. The
 * framework auto-creates a `default` site at boot when the
 * table is empty so single-tenant installs keep working
 * without operator intervention. Subsequent sites are added
 * via the super-admin UI (15.3) — the framework treats
 * additional sites as additive: they share users, plugins,
 * and theme code at install time, but each site has its own
 * collection content, navigation, and settings.
 *
 * `hostname` is nullable so the default site can match
 * "anything that doesn't have an explicit host route". When
 * a request's `Host` header matches a non-default site's
 * hostname, that site wins; otherwise the default site is
 * used. Multi-domain sites (apex + www) need separate rows
 * pointing at the same `id` — that's a 15.x follow-up;
 * v15.1 is one-hostname-per-site.
 */
export const npSites = pgTable(
  "np_sites",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    hostname: text("hostname"),
    description: text("description"),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [unique("np_sites_hostname_idx").on(table.hostname)],
);

export const npPlugins = pgTable("np_plugins", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  config: jsonb("config").$type<unknown>().notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/**
 * Phase 17 — plugin K/V storage with multi-tenant scope.
 *
 * The PK is `(plugin_id, site_id, key)`; `site_id` defaults to
 * `_global_` so single-site deploys (and pre-Phase-17 callers
 * that don't pass a site) keep their non-tenant behavior.
 * Plugin context auto-scopes reads/writes to the current site,
 * so plugin authors don't have to think about it — every plugin
 * operating inside a request automatically gets a per-site
 * keyspace, while background workers / scripts (no resolved
 * site) share the `_global_` space.
 */
export const NP_GLOBAL_PLUGIN_SITE_ID = "_global_";

export const npPluginStorage = pgTable(
  "np_plugin_storage",
  {
    pluginId: text("plugin_id").notNull(),
    siteId: text("site_id").default(NP_GLOBAL_PLUGIN_SITE_ID).notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pluginId, table.siteId, table.key] }),
    pluginIdx: index("np_plugin_storage_plugin_id_idx").on(table.pluginId),
    siteIdx: index("np_plugin_storage_site_idx").on(table.siteId),
  }),
);

/**
 * Phase 19 — worker liveness heartbeat. Each worker process
 * upserts a row keyed on its self-generated id (hostname + pid)
 * every `WORKER_HEARTBEAT_INTERVAL_MS` (30s). Admin reads this
 * to tell whether the queue actually has a process draining
 * jobs — without it the only signal was "Pending stays high
 * while Completed doesn't grow," which a stuck DB or a stopped
 * worker look identical from outside.
 *
 * Stale rows (no heartbeat for > 90s) are reported as
 * `unhealthy`; they survive in the table for forensic review
 * until an operator GCs them or a fresh worker reuses the id.
 */
export const npWorkerHeartbeats = pgTable("np_worker_heartbeats", {
  id: text("id").primaryKey(),
  status: text("status").default("running").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  /** Free-form metadata (worker version, hostname, env). */
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
});

/**
 * Phase 20.3 — per-job log capture. Each row is one structured
 * log entry recorded during a handler invocation. The framework
 * wraps every `boss.work()` callback in an AsyncLocalStorage
 * context so handlers calling `recordJobLog()` (or going through
 * the framework `getLogger()`) get their entries automatically
 * stamped with the running job's id.
 *
 * The `job_id` column is `text` (not `uuid`) because pg-boss job
 * ids are returned as strings and we want the relationship to
 * mirror what's surfaced to the admin without translation.
 *
 * Indexes target the two queries the admin will run:
 *   - "logs for this job" → (job_id, created_at)
 *   - "prune logs older than X" → (created_at)
 */
export const npJobLogs = pgTable(
  "np_job_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: text("job_id").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("np_job_logs_job_idx").on(table.jobId, table.createdAt),
    index("np_job_logs_created_idx").on(table.createdAt),
  ],
);
