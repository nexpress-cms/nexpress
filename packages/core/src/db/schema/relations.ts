import { relations } from "drizzle-orm";

import { npMedia, npMediaFolders, npMediaRefs } from "./media.js";
import { npNavigation, npRevisions, npSessions, npSettings, npUsers } from "./system.js";

export const npUsersRelations = relations(npUsers, ({ many, one }) => ({
  avatarMedia: one(npMedia, {
    fields: [npUsers.avatar],
    references: [npMedia.id],
    relationName: "userAvatar",
  }),
  sessions: many(npSessions),
  revisions: many(npRevisions),
  updatedSettings: many(npSettings),
  updatedNavigation: many(npNavigation),
  uploadedMedia: many(npMedia, { relationName: "uploadedMedia" }),
}));

export const npSessionsRelations = relations(npSessions, ({ one }) => ({
  user: one(npUsers, {
    fields: [npSessions.userId],
    references: [npUsers.id],
  }),
}));

export const npRevisionsRelations = relations(npRevisions, ({ one }) => ({
  author: one(npUsers, {
    fields: [npRevisions.authorId],
    references: [npUsers.id],
  }),
}));

export const npSettingsRelations = relations(npSettings, ({ one }) => ({
  updater: one(npUsers, {
    fields: [npSettings.updatedBy],
    references: [npUsers.id],
  }),
}));

export const npNavigationRelations = relations(npNavigation, ({ one }) => ({
  updater: one(npUsers, {
    fields: [npNavigation.updatedBy],
    references: [npUsers.id],
  }),
}));

export const npMediaFoldersRelations = relations(npMediaFolders, ({ many, one }) => ({
  parent: one(npMediaFolders, {
    fields: [npMediaFolders.parentId],
    references: [npMediaFolders.id],
    relationName: "mediaFolderHierarchy",
  }),
  children: many(npMediaFolders, { relationName: "mediaFolderHierarchy" }),
  media: many(npMedia),
}));

export const npMediaRelations = relations(npMedia, ({ many, one }) => ({
  folder: one(npMediaFolders, {
    fields: [npMedia.folderId],
    references: [npMediaFolders.id],
  }),
  uploader: one(npUsers, {
    fields: [npMedia.uploadedBy],
    references: [npUsers.id],
    relationName: "uploadedMedia",
  }),
  avatarUsers: many(npUsers, { relationName: "userAvatar" }),
  refs: many(npMediaRefs),
}));

export const npMediaRefsRelations = relations(npMediaRefs, ({ one }) => ({
  media: one(npMedia, {
    fields: [npMediaRefs.mediaId],
    references: [npMedia.id],
  }),
}));
