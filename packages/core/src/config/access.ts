import { type NxAccessFunction } from "./types.js";

export const authenticated: NxAccessFunction = ({ user }) => !!user;

export const isAdmin: NxAccessFunction = ({ user }) => user?.role === "admin";

export const isEditorOrAbove: NxAccessFunction = ({ user }) =>
  !!user && (user.role === "admin" || user.role === "editor");

export const isOwnerOrAdmin: NxAccessFunction = ({ user, doc }) =>
  user?.role === "admin" || doc?.createdBy === user?.id;
