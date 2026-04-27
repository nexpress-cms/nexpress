import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 14.5 — plugin-contributed page templates. Pin both
 * the registry merge (theme + plugins union) and the theme-
 * wins-collision policy. The actual catch-all render path
 * isn't unit-testable here (RSC + Next runtime); this
 * exercises the same `resolveTemplateComponent` helper the
 * route uses.
 */
describe.skipIf(skipIfNoTestDb())("plugin templates (Phase 14.5)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetPluginTemplates, resetThemes } = await import(
      "@nexpress/core"
    );
    resetPluginTemplates();
    resetThemes();
  });
  afterEach(async () => {
    const { resetPluginTemplates } = await import("@nexpress/core");
    resetPluginTemplates();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("getThemeTemplateSummaries merges plugin templates with the active theme's", async () => {
    const {
      registerPluginTemplates,
      registerThemes,
      getThemeTemplateSummaries,
    } = await import("@nexpress/core");

    registerThemes([
      {
        manifest: { id: "test-theme", name: "Test", version: "0.1.0" },
        impl: {
          templates: {
            pages: {
              wide: {
                label: "Wide",
                description: "Theme-shipped",
                component: () => null,
              },
            },
          },
        },
      },
    ]);

    registerPluginTemplates("docs", {
      pages: {
        docs: {
          label: "Documentation",
          description: "Plugin-shipped",
          component: () => null,
        },
      },
    });

    const summaries = await getThemeTemplateSummaries("pages");
    const ids = summaries.map((s) => s.id).sort();
    expect(ids).toEqual(["docs", "wide"]);
  });

  it("theme template wins on id collision (theme is the design authority)", async () => {
    const {
      registerPluginTemplates,
      registerThemes,
      getThemeTemplateSummaries,
    } = await import("@nexpress/core");

    registerThemes([
      {
        manifest: { id: "theme", name: "Theme", version: "0.1.0" },
        impl: {
          templates: {
            pages: {
              docs: {
                label: "Theme docs",
                component: () => null,
              },
            },
          },
        },
      },
    ]);

    registerPluginTemplates("docs", {
      pages: {
        docs: {
          label: "Plugin docs",
          component: () => null,
        },
      },
    });

    const summaries = await getThemeTemplateSummaries("pages");
    const docs = summaries.find((s) => s.id === "docs");
    expect(docs?.label).toBe("Theme docs");
  });

  it("resolveTemplateComponent prefers theme over plugin on the same id", async () => {
    const {
      registerPluginTemplates,
      registerThemes,
      resolveTemplateComponent,
    } = await import("@nexpress/core");

    const themeFn = () => null;
    const pluginFn = () => null;

    registerThemes([
      {
        manifest: { id: "theme", name: "Theme", version: "0.1.0" },
        impl: {
          templates: {
            pages: { docs: { label: "Theme", component: themeFn } },
          },
        },
      },
    ]);

    registerPluginTemplates("plugin-a", {
      pages: { docs: { label: "Plugin", component: pluginFn } },
    });

    const resolved = (await resolveTemplateComponent("pages", "docs")) as
      | { component?: () => null; label?: string }
      | null;
    expect(resolved?.component).toBe(themeFn);
  });

  it("resolveTemplateComponent falls through to plugin when theme has no entry for that id", async () => {
    const {
      registerPluginTemplates,
      registerThemes,
      resolveTemplateComponent,
    } = await import("@nexpress/core");

    const pluginFn = () => null;

    registerThemes([
      {
        manifest: { id: "theme", name: "Theme", version: "0.1.0" },
        impl: {
          templates: {
            pages: { default: { label: "Default", component: () => null } },
          },
        },
      },
    ]);

    registerPluginTemplates("docs", {
      pages: { docs: { label: "Docs", component: pluginFn } },
    });

    const resolved = (await resolveTemplateComponent("pages", "docs")) as
      | { component?: () => null }
      | null;
    expect(resolved?.component).toBe(pluginFn);
  });

  it("non-i18n collections still see their plugin templates (works for any collection)", async () => {
    const { registerPluginTemplates, getThemeTemplateSummaries } = await import(
      "@nexpress/core"
    );
    registerPluginTemplates("course", {
      posts: {
        lesson: { label: "Lesson", component: () => null },
      },
    });
    const summaries = await getThemeTemplateSummaries("posts");
    expect(summaries.find((s) => s.id === "lesson")).toBeDefined();
  });
});
