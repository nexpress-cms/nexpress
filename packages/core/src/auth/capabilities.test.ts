import { describe, it, expect } from "vitest";

import type { NpAuthUser, NpUserRole } from "../config/types.js";
import { can } from "./capabilities.js";

function userWithRole(role: NpUserRole): NpAuthUser {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "u1",
    role,
    tokenVersion: 0,
  };
}

describe("can()", () => {
  it("allows every authenticated staff role to use an authorized site context", () => {
    expect(can(userWithRole("viewer"), "site.access")).toBe(true);
    expect(can(null, "site.access")).toBe(false);
  });

  it("returns false for null / undefined principal regardless of capability", () => {
    expect(can(null, "content.publish")).toBe(false);
    expect(can(undefined, "community.moderate")).toBe(false);
  });

  describe("content.publish — editor or admin", () => {
    it.each([
      ["admin", true],
      ["editor", true],
      ["moderator", false],
      ["author", false],
      ["viewer", false],
    ] as const)("%s → %s", (role, expected) => {
      expect(can(userWithRole(role), "content.publish")).toBe(expected);
    });
  });

  describe("content.author — author/moderator/editor/admin", () => {
    it.each([
      ["admin", true],
      ["editor", true],
      ["moderator", true],
      ["author", true],
      ["viewer", false],
    ] as const)("%s → %s", (role, expected) => {
      expect(can(userWithRole(role), "content.author")).toBe(expected);
    });
  });

  describe("community.moderate — admin/editor/moderator", () => {
    it.each([
      ["admin", true],
      ["editor", true],
      ["moderator", true],
      ["author", false],
      ["viewer", false],
    ] as const)("%s → %s", (role, expected) => {
      expect(can(userWithRole(role), "community.moderate")).toBe(expected);
    });
  });

  describe("admin.manage — admin only", () => {
    it.each([
      ["admin", true],
      ["editor", false],
      ["moderator", false],
      ["author", false],
      ["viewer", false],
    ] as const)("%s → %s", (role, expected) => {
      expect(can(userWithRole(role), "admin.manage")).toBe(expected);
    });
  });
});
