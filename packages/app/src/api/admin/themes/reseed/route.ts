import {
  NP_DEFAULT_SITE_ID,
  NpForbiddenError,
  NpValidationError,
  can,
  findDocuments,
  getActiveTheme,
  getCurrentSiteId,
  getThemeById,
  setActiveThemeId,
  withCurrentSite,
} from "@nexpress/core";
import { readJsonBody, themeCacheTag } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  seedAll,
  wipeSeededContent,
} from "../../../../lib/seed-content";

/**
 * POST /api/admin/themes/reseed
 *
 * Destructive — wipes every page and post that carries a
 * `seed_source` marker, sets the chosen theme as active, then
 * runs the new theme's `seedAll`. Operator-authored content
 * (rows with `seed_source IS NULL`) is left untouched.
 *
 * Use cases:
 *
 *   - On a fresh install, the setup wizard's first-pass seed
 *     already does this — no need to call the endpoint.
 *   - When the operator wants to switch themes AND have the
 *     new theme's demo content reflect on the public site,
 *     this endpoint is the supported path. Plain "Activate"
 *     leaves the old theme's seeded rows in place; reseed
 *     replaces them.
 *
 * Caveats:
 *
 *   - Drizzle transactions don't propagate through hook
 *     callbacks (nav-cache busts, media refcount drops). The
 *     wipe + seed loop runs hook-per-row instead of inside a
 *     single transaction. A mid-flow failure leaves partial
 *     state; the operator re-runs the endpoint to finish.
 *   - Pre-PR1 installs have unmarked legacy seed rows
 *     (Welcome / About / Pricing / Contact pages with
 *     `seed_source IS NULL`). Reseed will *not* delete those
 *     — the operator either moves them to the trash manually
 *     or the new theme's pages slot in alongside them. A
 *     future migration may backfill `seed_source = "theme:default"`
 *     onto matched legacy rows; not done here.
 *
 * Capability: `admin.manage`. CSRF is enforced by `apps/web/src/proxy.ts`.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("write");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("themes/reseed", "execute");
    }

    const body = await readJsonBody(request);
    const themeId =
      typeof body === "object" && body !== null && "themeId" in body
        ? (body as { themeId?: unknown }).themeId
        : undefined;
    if (typeof themeId !== "string" || themeId.length === 0) {
      throw new NpValidationError("Invalid input", [
        { field: "themeId", message: "Target theme id is required" },
      ]);
    }
    const target = getThemeById(themeId);
    if (!target) {
      throw new NpValidationError("Invalid input", [
        {
          field: "themeId",
          message: `Unknown theme '${themeId}'. Register it in nexpress.config.ts first.`,
        },
      ]);
    }

    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;

    const result = await withCurrentSite(siteId, async () => {
      // Wipe before activation so the slug uniqueness constraint
      // on `/` doesn't collide between outgoing theme's home page
      // and the new theme's home page seed.
      const wiped = await wipeSeededContent(user);

      // Activate the new theme so `seedAll` (which reads the
      // active theme's seedContent through the registry) picks up
      // the target theme.
      await setActiveThemeId(themeId, user.id);
      const newActive = await getActiveTheme();
      if (!newActive || newActive.manifest.id !== themeId) {
        throw new Error(
          `Active-theme write succeeded but readback returned '${newActive?.manifest.id ?? "null"}' — aborting reseed.`,
        );
      }

      const seeded = await seedAll(user, newActive);
      return { wiped, seeded };
    });

    // Bust theme + SEO + sitemap + feed caches so the next public
    // request renders the new theme. Wrapped in try/catch because
    // `revalidateTag` throws outside a request context (test
    // harnesses) and we don't want a cache miss to surface as a
    // 500 when the persistence already succeeded.
    try {
      const { revalidatePath, revalidateTag } = await import("next/cache");
      revalidateTag(themeCacheTag(siteId), "default");
      revalidateTag(`nx:sitemap:${siteId}`, "default");
      revalidateTag(`nx:feed:${siteId}`, "default");
      revalidatePath("/", "layout");
    } catch {
      // ignore — see comment above
    }

    return npSuccessResponse({
      activeId: themeId,
      wiped: {
        pages: result.wiped.pagesDeleted,
        posts: result.wiped.postsDeleted,
      },
      seeded: {
        terms: result.seeded.terms,
        pages: result.seeded.pages,
        posts: result.seeded.posts,
        navigation: result.seeded.navigation,
      },
    });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}

/**
 * GET /api/admin/themes/reseed?themeId=<id>
 *
 * Preview — returns the counts the destructive POST would
 * operate on. The admin UI calls this before opening the
 * confirm dialog so the operator sees concrete numbers
 * ("4 pages, 14 posts will be deleted") instead of an abstract
 * warning.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureFor("read");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("themes/reseed", "read");
    }

    const url = new URL(request.url);
    const targetId = url.searchParams.get("themeId");
    const target = targetId ? getThemeById(targetId) : null;

    const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
    const counts = await withCurrentSite(siteId, async () => {
      const pages = await findDocuments<{ id: string; seedSource?: string }>(
        "pages",
        { limit: 500 },
      );
      const posts = await findDocuments<{ id: string; seedSource?: string }>(
        "posts",
        { limit: 500 },
      );
      const seedPages = pages.docs.filter((d) => Boolean(d.seedSource));
      const seedPosts = posts.docs.filter((d) => Boolean(d.seedSource));
      const legacyPages = pages.docs.filter((d) => !d.seedSource);
      const legacyPosts = posts.docs.filter((d) => !d.seedSource);
      return {
        seedMarked: { pages: seedPages.length, posts: seedPosts.length },
        legacyUnmarked: {
          pages: legacyPages.length,
          posts: legacyPosts.length,
        },
      };
    });

    return npSuccessResponse({
      target: target ? { id: target.manifest.id, name: target.manifest.name } : null,
      ...counts,
    });
  } catch (error) {
    return npErrorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
    );
  }
}
