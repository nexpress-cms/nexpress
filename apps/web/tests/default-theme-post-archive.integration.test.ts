import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("default theme post and archive rendering", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("plugins");
  });

  beforeEach(async () => {
    await truncateAll();
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { registerThemes, resetThemes } = await import("@nexpress/core");
    resetThemes();
    registerThemes([defaultTheme]);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedDefaultTheme() {
    const user = await seedUser({ role: "admin" });
    const actor = {
      id: user.userId,
      email: user.email,
      name: "Test Admin",
      role: user.role,
      tokenVersion: 0,
    };
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { seedAll } = await import("@/lib/seed-content");
    return seedAll(actor, defaultTheme);
  }

  it("renders a default single-post page with resolved tag links and related posts", async () => {
    await seedDefaultTheme();

    const { findDocuments } = await import("@nexpress/core");
    const result = await findDocuments<Record<string, unknown>>("posts", {
      where: { slug: "read-your-writes-without-the-asterisks", status: "published" },
      limit: 1,
    });
    const doc = result.docs[0];
    expect(doc).toBeDefined();

    const { PostDefaultTemplate } = await import("@nexpress/theme-default");
    const element = await PostDefaultTemplate({ doc: doc! });
    const html = renderToString(element);

    expect(html).toContain("np-post-hero");
    expect(html).toContain("Read-your-writes without the asterisks.");
    expect(html).toContain('href="/tag/postgres"');
    expect(html).not.toContain('href="/tags/');
    expect(html).toContain("np-post-related");
    expect(html).toContain("Why your index is fine");
  });

  it("renders the tag archive as a theme route backed by relationship filters", async () => {
    await seedDefaultTheme();

    const { createSiteScopedBlockRenderContext } = await import("@nexpress/next");
    const { DefaultTagArchiveRoute } = await import("@nexpress/theme-default");
    const element = await DefaultTagArchiveRoute({
      params: { slug: "postgres" },
      searchParams: {},
      blockCtx: await createSiteScopedBlockRenderContext(),
    });
    const html = renderToString(element);

    expect(html).toContain("np-default-tag-metrics");
    expect(html).toContain("topic archive");
    expect(html).toContain("active tags");
    expect(html).toContain("Read-your-writes without the asterisks.");
    expect(html).toContain("Why your index is fine");
    expect(html).toContain("np-default-tag-cloud");
    expect(html).toContain('href="/tag/postgres"');
  });
});
