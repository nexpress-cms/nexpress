import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 11.3 — page templates. The default theme registers two
 * `pages` templates (`default`, `wide`); the registry helper
 * surfaces them as summaries; the admin endpoint hands them to
 * the admin form's template-picker dropdown. These tests pin
 * each link in that chain.
 */
describe.skipIf(skipIfNoTestDb())("theme templates (Phase 11.3)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetThemes, registerThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    resetThemes();
    registerThemes([defaultTheme]);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("getThemeTemplateSummaries('pages') returns the default theme's templates", async () => {
    const { getThemeTemplateSummaries } = await import("@nexpress/core");
    const docs = await getThemeTemplateSummaries("pages");
    const ids = docs.map((d) => d.id).sort();
    expect(ids).toEqual(["default", "wide"]);
    const def = docs.find((d) => d.id === "default");
    expect(def?.label).toBe("Default");
    expect(typeof def?.description).toBe("string");
  });

  it("getThemeTemplateSummaries returns [] for a collection without registered templates", async () => {
    const { getThemeTemplateSummaries } = await import("@nexpress/core");
    const docs = await getThemeTemplateSummaries("posts");
    expect(docs).toEqual([]);
  });

  it("getThemeTemplateSummaries returns [] when active theme has no templates at all", async () => {
    const { resetThemes, registerThemes, getThemeTemplateSummaries } =
      await import("@nexpress/core");
    resetThemes();
    registerThemes([
      {
        manifest: { id: "bare", name: "Bare", version: "0.1.0" },
        impl: {},
      },
    ]);
    const docs = await getThemeTemplateSummaries("pages");
    expect(docs).toEqual([]);
  });

  it("admin endpoint returns the active theme's templates for editor+", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import(
      "@/app/api/admin/themes/active/templates/route"
    );
    const req = buildRequest("/api/admin/themes/active/templates", {
      session: editor,
      query: { collection: "pages" },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ id: string; label: string }>;
    }>(res);
    expect(status).toBe(200);
    const ids = (body.docs ?? []).map((d) => d.id).sort();
    expect(ids).toEqual(["default", "wide"]);
  });

  it("admin endpoint requires a `collection` query param", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import(
      "@/app/api/admin/themes/active/templates/route"
    );
    const req = buildRequest("/api/admin/themes/active/templates", {
      session: editor,
    });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("admin endpoint forbids viewers (editor-or-above gate)", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import(
      "@/app/api/admin/themes/active/templates/route"
    );
    const req = buildRequest("/api/admin/themes/active/templates", {
      session: viewer,
      query: { collection: "pages" },
    });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("default theme's `wide` template renders without the centered max-width container", async () => {
    // Sanity-check the template component. The `wide` variant
    // should opt out of the standard `nx-page` max-width by
    // adding the `nx-page-wide` class — that's the contract the
    // theme CSS hooks into.
    const { defaultTheme } = await import("@nexpress/theme-default");
    const impl = defaultTheme.impl as {
      templates?: Record<
        string,
        Record<
          string,
          {
            component?: (props: {
              doc: Record<string, unknown>;
            }) => React.ReactElement;
            label?: string;
          }
        >
      >;
    };
    const wide = impl.templates?.pages?.wide;
    expect(wide?.component).toBeTypeOf("function");
    expect(wide?.label).toBe("Wide");

    // The wide template must add `nx-page-wide` so the theme CSS
    // can drop the max-width. If a refactor accidentally removes
    // the class, page layouts silently regress to centered —
    // this assertion catches that.
    const Component = wide!.component!;
    const html = renderToString(Component({ doc: { title: "Hi" } }));
    expect(html).toContain("nx-page-wide");
  });

  it("default template renders the standard `nx-page` container", async () => {
    const { defaultTheme } = await import("@nexpress/theme-default");
    const impl = defaultTheme.impl as {
      templates?: Record<
        string,
        Record<
          string,
          {
            component?: (props: {
              doc: Record<string, unknown>;
            }) => React.ReactElement;
          }
        >
      >;
    };
    const Component = impl.templates!.pages!.default!.component!;
    const html = renderToString(Component({ doc: { title: "Hello" } }));
    // Default keeps the centered container (no `wide` modifier).
    expect(html).toContain("nx-page");
    expect(html).not.toContain("nx-page-wide");
    expect(html).toContain("Hello");
  });
});
