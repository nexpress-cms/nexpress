import { type NpAccessFunction } from "./types.js";

export const authenticated: NpAccessFunction = ({ user }) => !!user;

export const isAdmin: NpAccessFunction = ({ user }) => user?.role === "admin";

export const isEditorOrAbove: NpAccessFunction = ({ user }) =>
  !!user && (user.role === "admin" || user.role === "editor");

export const isOwnerOrAdmin: NpAccessFunction = ({ user, doc }) =>
  user?.role === "admin" || doc?.createdBy === user?.id;
