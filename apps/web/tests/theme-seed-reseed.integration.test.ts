import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Theme track integration tests (PRs #779-#785 redesigned the four
 * built-in themes + reshaped the seed pipeline; per the track's
 * follow-up memo, "Zero new tests across PRs #779-#785 — integration
 * test surface for the seeder, the reseed flow, and the per-theme
 * front pages is empty.").
 *
 * These tests close the data-layer gap: seed/reseed/idempotency
 * against a real Postgres. Render-side scenarios (magazine `/` as
 * post-list editorial, portfolio `/` as 12-col grid, etc.) live in
 * Playwright e2e territory and are out of scope here.
 *
 * Coverage:
 *
 *   - `seedAll(default)` stamps `seed_source = "theme:default"` on
 *     every row it creates (pages + posts).
 *   - Running `seedAll(default)` twice is a no-op the second time —
 *     the per-theme idempotency gate at `seed-content.ts` checks
 *     `findDocuments({ where: { seedSource: "theme:<id>" } })` and
 *     skips if any match exists.
 *   - Switching theme + reseeding hits a fresh seed_source value
 *     (`theme:magazine`), and the seed pipeline writes the
 *     magazine theme's content.
 *   - `wipeSeededContent(actor)` removes only rows with non-null
 *     `seed_source` — operator-authored rows (seed_source IS NULL)
 *     survive.
 */
describe.skipIf(skipIfNoTestDb())("theme seed + reseed pipeline", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    // "plugins" tier so post-save hooks (search-vector, slug, etc.)
    // fire during seed — matches what the real first-boot path does.
    await ensureFor("plugins");
  });

  beforeEach(async () => {
    await truncateAll();
    const { resetThemes, registerThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([defaultTheme, magazineTheme]);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function asActor() {
    // Builds the `NpAuthUser` shape the seeder expects from what
    // `seedUser` returns. `tokenVersion: 0` matches what `seedUser`
    // inserts (the DB column default); the seeder never gates on
    // tokenVersion anyway — it's metadata threaded into audit rows.
    const user = await seedUser({ role: "admin" });
    return {
      id: user.userId,
      email: user.email,
      name: "Test Admin",
      role: user.role,
      tokenVersion: 0,
    };
  }

  it("seedAll(default) stamps seed_source on every page + post it creates", async () => {
    const actor = await asActor();
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { seedAll } = await import("@/lib/seed-content");

    const result = await seedAll(actor, defaultTheme);

    expect(result.pages.created).toBeGreaterThan(0);
    expect(result.posts.created).toBeGreaterThan(0);

    // Direct DB assert — every seeded row gets seed_source = "theme:default".
    // No mix of marked + unmarked from a single seedAll(themed) call.
    const db = await getTestDb();
    const { eq, sql } = await import("drizzle-orm");
    const { pagesTable, postsTable } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/integration/fixtures.js"
    );

    const pagesMarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(eq(pagesTable.seedSource, "theme:default"));
    expect(pagesMarked[0]?.count ?? 0).toBe(result.pages.created);

    const postsMarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postsTable)
      .where(eq(postsTable.seedSource, "theme:default"));
    expect(postsMarked[0]?.count ?? 0).toBe(result.posts.created);

    // And no rows with NULL seed_source — operator content hasn't been
    // mixed in yet.
    const pagesUnmarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(sql`${pagesTable.seedSource} is null`);
    expect(pagesUnmarked[0]?.count ?? 0).toBe(0);
  });

  it("seedAll(default) twice is idempotent — second call skips creation", async () => {
    const actor = await asActor();
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { seedAll } = await import("@/lib/seed-content");

    const first = await seedAll(actor, defaultTheme);
    expect(first.pages.created).toBeGreaterThan(0);

    const second = await seedAll(actor, defaultTheme);
    // Per-theme idempotency gate — if ANY row with this seedSource
    // exists, the seeder skips. `skipped: true` is the contract.
    expect(second.pages.skipped).toBe(true);
    expect(second.pages.created).toBe(0);
    expect(second.posts.skipped).toBe(true);
    expect(second.posts.created).toBe(0);

    // DB row count unchanged across the two calls.
    const db = await getTestDb();
    const { sql } = await import("drizzle-orm");
    const { pagesTable, postsTable } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/integration/fixtures.js"
    );
    const totalPages = await db.select({ count: sql<number>`count(*)::int` }).from(pagesTable);
    expect(totalPages[0]?.count ?? 0).toBe(first.pages.created);
    const totalPosts = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable);
    expect(totalPosts[0]?.count ?? 0).toBe(first.posts.created);
  });

  it("reseed flow (wipe default → seed magazine) writes magazine content tagged theme:magazine", async () => {
    // Mirrors the real reseed endpoint
    // (`api/admin/themes/reseed/route.ts`): seedAll(theme) by itself
    // would fail on a slug collision when both themes ship a `/`
    // home page, which is why the production reseed wraps wipe +
    // activate + seed in a single transaction. This test exercises
    // that ordering at the data-layer pieces (`wipeSeededContent` +
    // `seedAll`) without the route's tx wrapping — that's what the
    // route's own integration tests cover separately.
    const actor = await asActor();
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    const { seedAll, wipeSeededContent } = await import("@/lib/seed-content");

    // First seed default to populate `theme:default` rows.
    await seedAll(actor, defaultTheme);

    // Wipe before activating the next theme — the slug uniqueness
    // constraint (`site_id, locale, slug`) would otherwise reject
    // magazine's `/` page on top of default's `/`.
    await wipeSeededContent(actor);

    const magResult = await seedAll(actor, magazineTheme);
    expect(magResult.posts.created).toBeGreaterThan(0);

    const db = await getTestDb();
    const { eq, sql } = await import("drizzle-orm");
    const { postsTable } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/integration/fixtures.js"
    );

    // After wipe: zero theme:default rows; all posts are theme:magazine.
    const defaultPosts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postsTable)
      .where(eq(postsTable.seedSource, "theme:default"));
    const magazinePosts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postsTable)
      .where(eq(postsTable.seedSource, "theme:magazine"));

    expect(defaultPosts[0]?.count ?? 0).toBe(0);
    expect(magazinePosts[0]?.count ?? 0).toBeGreaterThan(0);
    expect(magazinePosts[0]?.count).toBe(magResult.posts.created);
  });

  it("wipeSeededContent removes seed-marked rows but leaves operator content intact", async () => {
    const actor = await asActor();
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { seedAll, wipeSeededContent } = await import("@/lib/seed-content");
    const { saveDocument } = await import("@nexpress/core");

    // Seed framework content.
    const seedResult = await seedAll(actor, defaultTheme);
    expect(seedResult.pages.created).toBeGreaterThan(0);

    // Operator authors a page directly (no seedSource). This is the
    // case the wipe MUST preserve — losing it is the regression we
    // most care about.
    await saveDocument(
      "pages",
      null,
      {
        title: "Operator's manual page",
        slug: "operator-page",
        // The pages collection ships with a `blocks` field that
        // accepts an empty array.
        blocks: [],
      },
      actor,
      { status: "published" },
    );

    // Pre-wipe sanity: marked + unmarked both exist.
    const db = await getTestDb();
    const { eq, sql } = await import("drizzle-orm");
    const { pagesTable } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/integration/fixtures.js"
    );
    const preMarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(eq(pagesTable.seedSource, "theme:default"));
    const preUnmarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(sql`${pagesTable.seedSource} is null`);
    expect(preMarked[0]?.count ?? 0).toBeGreaterThan(0);
    expect(preUnmarked[0]?.count ?? 0).toBe(1);

    // Wipe.
    const wiped = await wipeSeededContent(actor);
    expect(wiped.pagesDeleted).toBe(preMarked[0]?.count);

    // Post-wipe: no marked rows, the one operator row survives.
    const postMarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(sql`${pagesTable.seedSource} is not null`);
    expect(postMarked[0]?.count ?? 0).toBe(0);

    const postUnmarked = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pagesTable)
      .where(sql`${pagesTable.seedSource} is null`);
    expect(postUnmarked[0]?.count ?? 0).toBe(1);
  });
});
