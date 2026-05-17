import {
  NP_DEFAULT_SITE_ID,
  NpConflictError,
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
import { bustThemeCache, readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { npErrorResponse, npSuccessResponse } from "../../../../lib/api-response";
import { requireAuth } from "../../../../lib/auth-helpers";
import { ensureFor } from "../../../../lib/init-core";
import {
  seedAll,
  wipeSeededContent,
} from "../../../../lib/seed-content";

/**
 * Pull the offending slug out of a postgres unique-violation error.
 * pg-node surfaces the constraint failure as a `DatabaseError` with
 * `code: "23505"` and a `detail` field of the form
 * `Key (site_id, locale, slug)=(default, en, /) already exists.`.
 * When detail is missing or unparseable, returns null so the caller
 * falls back to re-throwing the original error.
 */
function parseSlugCollision(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  const detail = (error as { detail?: unknown }).detail;
  const message = error instanceof Error ? error.message : "";
  const isUniqueViolation =
    code === "23505" ||
    /np_c_pages_site_locale_slug_idx|unique constraint|duplicate key/i.test(message);
  if (!isUniqueViolation) return null;
  const detailStr = typeof detail === "string" ? detail : message;
  const match = detailStr.match(/slug\)=\(.*?,\s*[^,]+,\s*([^)]+)\)/);
  return match?.[1]?.trim() ?? null;
}

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
 *   - Pre-PR1 installs have unmarked legacy seed rows. Migration
 *     `0007_legacy_seed_backfill` stamps `seed_source =
 *     "theme:default"` onto pages whose slug matches the
 *     framework's original marketing seed (`/`, `about`,
 *     `pricing`, `contact`). Operator-edited slugs are left
 *     untouched on purpose — if reseed then hits a slug
 *     uniqueness violation we surface a 409 with the offending
 *     slug, so the operator knows which row to resolve.
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

      try {
        const seeded = await seedAll(user, newActive);
        return { wiped, seeded };
      } catch (error) {
        const collisionSlug = parseSlugCollision(error);
        if (collisionSlug) {
          throw new NpConflictError(
            `Cannot seed theme "${themeId}" — a page with slug "${collisionSlug}" already exists and isn't marked as framework seed. Delete or rename it and re-run reseed.`,
          );
        }
        throw error;
      }
    });

    // Bust theme + SEO + sitemap + feed caches so the next public
    // request renders the new theme. Helper swallows the throw
    // that fires outside a request context.
    await bustThemeCache(siteId);

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
