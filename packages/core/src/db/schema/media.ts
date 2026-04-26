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

import { nxMembers } from "./community.js";
import { nxUsers } from "./system.js";
import { type NxRichTextContent } from "../../config/types.js";

export const nxMediaStatusEnum = pgEnum("nx_media_status", [
  "processing",
  "ready",
  "error",
]);

type NxMediaFocalPoint = {
  x: number;
  y: number;
};

type NxMediaSizes = Record<string, Record<string, unknown>>;

export const nxMediaFolders = pgTable("nx_media_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => nxMediaFolders.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
});

export const nxMedia = pgTable(
  "nx_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    filesize: bigint("filesize", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    caption: jsonb("caption").$type<NxRichTextContent>(),
    focalPoint: jsonb("focal_point").$type<NxMediaFocalPoint>(),
    sizes: jsonb("sizes").$type<NxMediaSizes>(),
    storageKey: text("storage_key").notNull(),
    hash: text("hash").notNull(),
    status: nxMediaStatusEnum("status").notNull(),
    folderId: uuid("folder_id").references(() => nxMediaFolders.id),
    uploadedBy: uuid("uploaded_by").references((): AnyPgColumn => nxUsers.id),
    /**
     * Set when a member uploaded the row instead of a staff user
     * (Phase 9.7j). Mutually exclusive with `uploadedBy`: a row
     * has exactly one uploader. Member-side moderation tools key
     * off this column to filter "uploads I should review."
     * `ON DELETE SET NULL` so a member account deletion doesn't
     * cascade-delete their uploads — staff still need them for
     * the audit trail (just like `member_author_id` on
     * collection tables).
     */
    uploadedByMemberId: uuid("uploaded_by_member_id").references(
      (): AnyPgColumn => nxMembers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    hashIdx: index("nx_media_hash_idx").on(table.hash),
    statusIdx: index("nx_media_status_idx").on(table.status),
    uploadedByMemberIdx: index("nx_media_uploaded_by_member_idx").on(
      table.uploadedByMemberId,
    ),
  }),
);

export const nxMediaRefs = pgTable(
  "nx_media_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => nxMedia.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    documentId: text("document_id").notNull(),
    field: text("field").notNull(),
  },
  (table) => ({
    mediaIdIdx: index("nx_media_refs_media_id_idx").on(table.mediaId),
    documentIdIdx: index("nx_media_refs_document_id_idx").on(table.documentId),
  }),
);
