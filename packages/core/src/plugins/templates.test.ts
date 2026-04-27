import { afterEach, describe, expect, it } from "vitest";

import {
  getPluginTemplatesForCollection,
  registerPluginTemplates,
  resetPluginTemplates,
} from "./templates.js";

/**
 * Phase 14.5 — plugin template registry. The registry is a
 * separate store from the theme template registry; the
 * theme registry's `getThemeTemplateSummaries` merges them.
 * Tests here cover only the plugin-side store; the merge +
 * theme-wins-collisions behavior is covered by the theme
 * registry's tests.
 */
describe("plugin template registry (Phase 14.5)", () => {
  afterEach(() => {
    resetPluginTemplates();
  });

  it("registerPluginTemplates puts entries in the registry, keyed by collection + id", () => {
    registerPluginTemplates("docs", {
      pages: {
        docs: { label: "Documentation", component: () => null },
      },
    });
    const set = getPluginTemplatesForCollection("pages");
    expect(set.size).toBe(1);
    expect(set.get("docs")).toBeDefined();
  });

  it("returns an empty map for collections no plugin contributed templates to", () => {
    expect(getPluginTemplatesForCollection("ghost")).toEqual(new Map());
  });

  it("re-registering the same plugin replaces its prior entries (idempotent)", () => {
    registerPluginTemplates("docs", {
      pages: { docs: { label: "v1", component: () => null } },
    });
    registerPluginTemplates("docs", {
      pages: { docs: { label: "v2", component: () => null } },
    });
    const entry = getPluginTemplatesForCollection("pages").get("docs") as
      | { label: string }
      | undefined;
    expect(entry?.label).toBe("v2");
  });

  it("re-registering a plugin does NOT touch other plugins' entries", () => {
    registerPluginTemplates("docs", {
      pages: { docs: { label: "Docs", component: () => null } },
    });
    registerPluginTemplates("events", {
      pages: { event: { label: "Event", component: () => null } },
    });
    // Re-register docs — should keep events alone.
    registerPluginTemplates("docs", {
      pages: { docs: { label: "Docs v2", component: () => null } },
    });
    const set = getPluginTemplatesForCollection("pages");
    expect(set.size).toBe(2);
    expect(set.get("event")).toBeDefined();
  });

  it("plugins from different ids that target the same id collide deterministically (last writer wins)", () => {
    registerPluginTemplates("a", {
      pages: { shared: { label: "From A", component: () => null } },
    });
    registerPluginTemplates("b", {
      pages: { shared: { label: "From B", component: () => null } },
    });
    const entry = getPluginTemplatesForCollection("pages").get("shared") as
      | { label: string }
      | undefined;
    expect(entry?.label).toBe("From B");
  });

  it("multiple collections are isolated", () => {
    registerPluginTemplates("docs", {
      pages: { docs: { label: "Docs", component: () => null } },
      posts: { tutorial: { label: "Tutorial", component: () => null } },
    });
    expect(getPluginTemplatesForCollection("pages").size).toBe(1);
    expect(getPluginTemplatesForCollection("posts").size).toBe(1);
    expect(
      (getPluginTemplatesForCollection("posts").get("tutorial") as { label: string })
        .label,
    ).toBe("Tutorial");
  });

  it("resetPluginTemplates wipes everything", () => {
    registerPluginTemplates("docs", {
      pages: { docs: { label: "Docs", component: () => null } },
    });
    resetPluginTemplates();
    expect(getPluginTemplatesForCollection("pages").size).toBe(0);
  });
});
