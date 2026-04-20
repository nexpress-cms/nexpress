import { relations } from "drizzle-orm";

import { nxMedia, nxMediaFolders, nxMediaRefs } from "./media.js";
import { nxNavigation, nxRevisions, nxSessions, nxSettings, nxUsers } from "./system.js";

export const nxUsersRelations = relations(nxUsers, ({ many, one }) => ({
  avatarMedia: one(nxMedia, {
    fields: [nxUsers.avatar],
    references: [nxMedia.id],
    relationName: "userAvatar",
  }),
  sessions: many(nxSessions),
  revisions: many(nxRevisions),
  updatedSettings: many(nxSettings),
  updatedNavigation: many(nxNavigation),
  uploadedMedia: many(nxMedia, { relationName: "uploadedMedia" }),
}));

export const nxSessionsRelations = relations(nxSessions, ({ one }) => ({
  user: one(nxUsers, {
    fields: [nxSessions.userId],
    references: [nxUsers.id],
  }),
}));

export const nxRevisionsRelations = relations(nxRevisions, ({ one }) => ({
  author: one(nxUsers, {
    fields: [nxRevisions.authorId],
    references: [nxUsers.id],
  }),
}));

export const nxSettingsRelations = relations(nxSettings, ({ one }) => ({
  updater: one(nxUsers, {
    fields: [nxSettings.updatedBy],
    references: [nxUsers.id],
  }),
}));

export const nxNavigationRelations = relations(nxNavigation, ({ one }) => ({
  updater: one(nxUsers, {
    fields: [nxNavigation.updatedBy],
    references: [nxUsers.id],
  }),
}));

export const nxMediaFoldersRelations = relations(nxMediaFolders, ({ many, one }) => ({
  parent: one(nxMediaFolders, {
    fields: [nxMediaFolders.parentId],
    references: [nxMediaFolders.id],
    relationName: "mediaFolderHierarchy",
  }),
  children: many(nxMediaFolders, { relationName: "mediaFolderHierarchy" }),
  media: many(nxMedia),
}));

export const nxMediaRelations = relations(nxMedia, ({ many, one }) => ({
  folder: one(nxMediaFolders, {
    fields: [nxMedia.folderId],
    references: [nxMediaFolders.id],
  }),
  uploader: one(nxUsers, {
    fields: [nxMedia.uploadedBy],
    references: [nxUsers.id],
    relationName: "uploadedMedia",
  }),
  avatarUsers: many(nxUsers, { relationName: "userAvatar" }),
  refs: many(nxMediaRefs),
}));

export const nxMediaRefsRelations = relations(nxMediaRefs, ({ one }) => ({
  media: one(nxMedia, {
    fields: [nxMediaRefs.mediaId],
    references: [nxMedia.id],
  }),
}));
