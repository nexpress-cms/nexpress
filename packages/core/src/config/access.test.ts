import { describe, expect, it } from "vitest";

import {
  authenticated,
  isAdmin,
  isEditorOrAbove,
  isOwnerOrAdmin,
} from "./access.js";
import type { NxAuthUser } from "./types.js";

function user(role: NxAuthUser["role"], id = "user-1"): NxAuthUser {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role,
    tokenVersion: 0,
  };
}

describe("access helpers", () => {
  describe("authenticated", () => {
    it("allows any signed-in user", () => {
      expect(authenticated({ user: user("viewer") })).toBe(true);
    });

    it("denies anonymous callers", () => {
      expect(authenticated({ user: null })).toBe(false);
    });
  });

  describe("isAdmin", () => {
    it("allows admin", () => {
      expect(isAdmin({ user: user("admin") })).toBe(true);
    });

    it.each(["editor", "author", "viewer"] as const)("denies role=%s", (role) => {
      expect(isAdmin({ user: user(role) })).toBe(false);
    });

    it("denies anonymous", () => {
      expect(isAdmin({ user: null })).toBe(false);
    });
  });

  describe("isEditorOrAbove", () => {
    it.each(["admin", "editor"] as const)("allows role=%s", (role) => {
      expect(isEditorOrAbove({ user: user(role) })).toBe(true);
    });

    it.each(["author", "viewer"] as const)("denies role=%s", (role) => {
      expect(isEditorOrAbove({ user: user(role) })).toBe(false);
    });

    it("denies anonymous", () => {
      expect(isEditorOrAbove({ user: null })).toBe(false);
    });
  });

  describe("isOwnerOrAdmin", () => {
    it("allows admin regardless of ownership", () => {
      expect(
        isOwnerOrAdmin({
          user: user("admin", "admin-1"),
          doc: { createdBy: "someone-else" },
        }),
      ).toBe(true);
    });

    it("allows author when they own the document", () => {
      expect(
        isOwnerOrAdmin({
          user: user("author", "owner-1"),
          doc: { createdBy: "owner-1" },
        }),
      ).toBe(true);
    });

    it("denies author when they don't own the document", () => {
      expect(
        isOwnerOrAdmin({
          user: user("author", "intruder-1"),
          doc: { createdBy: "owner-1" },
        }),
      ).toBe(false);
    });

    it("denies anonymous", () => {
      expect(isOwnerOrAdmin({ user: null, doc: { createdBy: "owner-1" } })).toBe(false);
    });
  });
});
