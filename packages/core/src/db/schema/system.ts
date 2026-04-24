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

import { nxMedia } from "./media.js";
import {
  type NxBlockInstance,
  type NxNavItem,
  type NxRichTextContent,
} from "../../config/types.js";

export const nxUserRoleEnum = pgEnum("nx_user_role", [
  "admin",
  "editor",
  "author",
  "viewer",
]);

export const nxRevisionStatusEnum = pgEnum("nx_revision_status", [
  "draft",
  "published",
  "autosave",
]);

type NxRevisionSnapshot = Record<string, unknown> & {
  blocks?: NxBlockInstance[];
  content?: NxRichTextContent;
};

export const nxPasswordResetPurposeEnum = pgEnum("nx_password_reset_purpose", [
  "invite",
  "reset",
]);

export const nxUsers = pgTable("nx_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: nxUserRoleEnum("role").notNull(),
  avatar: uuid("avatar").references((): AnyPgColumn => nxMedia.id),
  loginAttempts: integer("login_attempts").default(0).notNull(),
  lockUntil: timestamp("lock_until", { withTimezone: true, mode: "date" }),
  tokenVersion: integer("token_version").default(0).notNull(),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  passwordResetPurpose: nxPasswordResetPurposeEnum("password_reset_purpose"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const nxSessions = pgTable("nx_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => nxUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const nxRevisions = pgTable(
  "nx_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    status: nxRevisionStatusEnum("status").notNull(),
    snapshot: jsonb("snapshot").$type<NxRevisionSnapshot>().notNull(),
    changedFields: text("changed_fields").array().notNull(),
    authorId: uuid("author_id").references(() => nxUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    documentVersionUnique: unique("nx_revisions_document_id_version_unique").on(
      table.documentId,
      table.version,
    ),
    collectionIdx: index("nx_revisions_collection_idx").on(table.collection),
    documentIdIdx: index("nx_revisions_document_id_idx").on(table.documentId),
  }),
);

export const nxSettings = pgTable("nx_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedBy: uuid("updated_by").references(() => nxUsers.id),
});

export const nxNavigation = pgTable("nx_navigation", {
  id: uuid("id").defaultRandom().primaryKey(),
  location: text("location").notNull().unique(),
  items: jsonb("items").$type<NxNavItem[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedBy: uuid("updated_by").references(() => nxUsers.id),
});

export const nxPlugins = pgTable("nx_plugins", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  config: jsonb("config").$type<unknown>().notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const nxPluginStorage = pgTable(
  "nx_plugin_storage",
  {
    pluginId: text("plugin_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pluginId, table.key] }),
    pluginIdx: index("nx_plugin_storage_plugin_id_idx").on(table.pluginId),
  }),
);
