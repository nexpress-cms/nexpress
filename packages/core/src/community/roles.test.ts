import { afterEach, describe, expect, it } from "vitest";

import {
  getCommunityRole,
  listCommunityRoles,
  registerCommunityRole,
  resetCommunityRoles,
} from "./roles.js";
import { getCommunityRuntimeDiagnostics, resetCommunityRuntimeDiagnostics } from "./diagnostics.js";

describe("community role registry", () => {
  afterEach(() => {
    resetCommunityRoles();
    resetCommunityRuntimeDiagnostics();
  });

  it("ships the four built-in roles", () => {
    const all = listCommunityRoles();
    const keys = all.map((r) => `${r.scopeType}:${r.role}`).sort();
    expect(keys).toEqual([
      "category:category-mod",
      "collection:collection-mod",
      "site:community-mod",
      "thread:thread-author",
    ]);
  });

  it("community-mod (site) has every site-wide capability except own-only ones", () => {
    const def = getCommunityRole("community-mod", "site");
    expect(def?.capabilities).toContain("hide-comment");
    expect(def?.capabilities).toContain("manage-category");
    expect(def?.capabilities).toContain("ban-member");
    // Own-only caps belong to thread-author, not community-mod
    expect(def?.capabilities).not.toContain("edit-own-thread");
  });

  it("collection-mod has comment-side capabilities only — not thread-side", () => {
    const def = getCommunityRole("collection-mod", "collection");
    expect(def?.capabilities).toContain("hide-comment");
    expect(def?.capabilities).toContain("delete-any-comment");
    expect(def?.capabilities).not.toContain("hide-thread");
    expect(def?.capabilities).not.toContain("lock-thread");
  });

  it("thread-author has only own-thread capabilities", () => {
    const def = getCommunityRole("thread-author", "thread");
    expect(def?.capabilities).toEqual(["edit-own-thread", "lock-own-thread"]);
  });

  it("registerCommunityRole adds a custom role with a separate (role, scope) pair", () => {
    registerCommunityRole({
      role: "tag-mod",
      scopeType: "category",
      capabilities: ["hide-comment"],
    });
    const def = getCommunityRole("tag-mod", "category");
    expect(def?.capabilities).toEqual(["hide-comment"]);
  });

  it("registerCommunityRole rejects duplicate (role, scope) registrations", () => {
    expect(() =>
      registerCommunityRole({
        role: "community-mod",
        scopeType: "site",
        capabilities: ["hide-comment"],
      }),
    ).toThrow(/already registered/);

    registerCommunityRole({
      role: "tag-mod",
      scopeType: "category",
      capabilities: ["hide-comment"],
    });
    expect(() =>
      registerCommunityRole({
        role: "tag-mod",
        scopeType: "category",
        capabilities: ["lock-thread"],
      }),
    ).toThrow(/already registered/);
    expect(getCommunityRuntimeDiagnostics()).toEqual([
      expect.objectContaining({
        source: "roles",
        message: expect.stringContaining("already registered"),
      }),
      expect.objectContaining({
        source: "roles",
        message: expect.stringContaining("already registered"),
      }),
    ]);
  });

  it("the same role name on a different scope IS allowed", () => {
    expect(() =>
      registerCommunityRole({
        role: "tag-mod",
        scopeType: "category",
        capabilities: ["hide-comment"],
      }),
    ).not.toThrow();
    expect(() =>
      registerCommunityRole({
        role: "tag-mod",
        scopeType: "thread",
        capabilities: ["hide-comment"],
      }),
    ).not.toThrow();
  });

  it("listCommunityRoles filters by scope type when given one", () => {
    registerCommunityRole({
      role: "tag-mod",
      scopeType: "category",
      capabilities: ["hide-comment"],
    });
    const categoryRoles = listCommunityRoles("category");
    expect(categoryRoles.map((r) => r.role).sort()).toEqual(["category-mod", "tag-mod"]);

    const siteRoles = listCommunityRoles("site");
    expect(siteRoles.map((r) => r.role)).toEqual(["community-mod"]);
  });

  it("validates definitions and returns detached capability arrays", () => {
    expect(() =>
      registerCommunityRole({
        role: "Bad Role",
        scopeType: "site",
        capabilities: ["hide-comment"],
      }),
    ).toThrow(/canonical role id/);

    const first = getCommunityRole("community-mod", "site");
    if (!first) throw new Error("missing built-in role");
    (first.capabilities as string[]).push("edit-own-thread");
    expect(getCommunityRole("community-mod", "site")?.capabilities).not.toEqual(first.capabilities);
  });
});
