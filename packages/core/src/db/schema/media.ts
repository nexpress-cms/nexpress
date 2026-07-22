import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { npMembers } from "./community.js";
import { npUsers } from "./system.js";
import { type NpRichTextContent } from "../../fields/rich-text.js";
import type { NpMediaFocalPoint, NpMediaVariants } from "../../media-contract/types.js";

export const npMediaStatusEnum = pgEnum("np_media_status", ["processing", "ready", "error"]);

export const npMediaFolders = pgTable(
  "np_media_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").default("default").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => npMediaFolders.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    siteParentIdx: index("np_media_folders_site_parent_idx").on(table.siteId, table.parentId),
  }),
);

export const npMedia = pgTable(
  "np_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").default("default").notNull(),
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    filesize: bigint("filesize", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    caption: jsonb("caption").$type<NpRichTextContent>(),
    focalPoint: jsonb("focal_point").$type<NpMediaFocalPoint>(),
    sizes: jsonb("sizes").$type<NpMediaVariants>(),
    storageKey: text("storage_key").notNull(),
    hash: text("hash").notNull(),
    status: npMediaStatusEnum("status").notNull(),
    folderId: uuid("folder_id").references(() => npMediaFolders.id),
    uploadedBy: uuid("uploaded_by").references((): AnyPgColumn => npUsers.id),
    /**
     * Set when a member uploaded the row instead of a staff user
     * (Phase 9.7j). Mutually exclusive with `uploadedBy`: a row
     * has at most one human uploader, while plugin/system uploads
     * may have neither. Member-side moderation tools key off this
     * column to filter "uploads I should review."
     * `ON DELETE SET NULL` so a member account deletion doesn't
     * cascade-delete their uploads — staff still need them for
     * the audit trail (just like `member_author_id` on
     * collection tables).
     */
    uploadedByMemberId: uuid("uploaded_by_member_id").references((): AnyPgColumn => npMembers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    hashIdx: index("np_media_hash_idx").on(table.hash),
    statusIdx: index("np_media_status_idx").on(table.status),
    siteCreatedIdx: index("np_media_site_created_idx").on(table.siteId, table.createdAt),
    siteHashIdx: index("np_media_site_hash_idx").on(table.siteId, table.hash),
    uploadedByMemberIdx: index("np_media_uploaded_by_member_idx").on(table.uploadedByMemberId),
  }),
);

export const npMediaRefs = pgTable(
  "np_media_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").default("default").notNull(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => npMedia.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    field: text("field").notNull(),
  },
  (table) => ({
    mediaIdIdx: index("np_media_refs_media_id_idx").on(table.mediaId),
    documentIdIdx: index("np_media_refs_document_id_idx").on(table.documentId),
    siteDocumentIdx: index("np_media_refs_site_document_idx").on(
      table.siteId,
      table.collection,
      table.documentId,
    ),
  }),
);
