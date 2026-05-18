import {
  NP_DEFAULT_SITE_ID,
  NpConflictError,
  NpForbiddenError,
  NpValidationError,
  can,
  getActiveTheme,
  getCurrentSiteId,
  getDb,
  getThemeById,
  setActiveThemeId,
  withCurrentSite,
} from "@nexpress/core";
import { bustThemeCache, readJsonBody } from "@nexpress/next";
import { sql } from "drizzle-orm";
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
 *   - The WIPE phase is now atomic — `wipeSeededContent` opens a
 *     single `db.transaction` and threads it through every per-row
 *     `deleteDocument({ tx })` call. A mid-wipe failure rolls back
 *     ALL the pending deletes and the cascade rows (child tables,
 *     media refs, comments, reactions, reports) along with them.
 *   - The SEED phase that follows is NOT inside the same tx —
 *     `seedAll`'s per-row `saveDocument` calls don't yet accept a
 *     tx parameter, and pulling them into one would force a much
 *     wider pipeline refactor. A failure during seed (most often
 *     the slug-collision case the 409 handler below catches)
 *     leaves the wipe committed and the seed half-written. The
 *     operator resolves the collision and re-runs; the seeder's
 *     per-theme idempotency check skips rows it already wrote.
 *   - Post-commit hooks (`content:afterDelete` job + plugin
 *     `content:afterDelete`) still fire per-row inside the wipe
 *     tx. Their side-effects (cache busts, audit log writes on a
 *     separate connection) can diverge from final DB state on
 *     rollback. Acceptable in practice — operator re-runs the
 *     wipe, hooks re-fire idempotently against canonical sources.
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
 *
 * Counts come from two `FILTER`-clause aggregates (one per
 * collection) so the response is bounded — no row-count cap
 * and no per-row deserialization. Site-scoped via `site_id`.
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
      const db = getDb();
      const [pagesRow, postsRow] = await Promise.all([
        db.execute<{ marked: number; unmarked: number }>(sql`
          select
            count(*) filter (where seed_source is not null)::int as marked,
            count(*) filter (where seed_source is null)::int as unmarked
          from np_c_pages
          where site_id = ${siteId}
        `),
        db.execute<{ marked: number; unmarked: number }>(sql`
          select
            count(*) filter (where seed_source is not null)::int as marked,
            count(*) filter (where seed_source is null)::int as unmarked
          from np_c_posts
          where site_id = ${siteId}
        `),
      ]);
      const pages = pagesRow.rows[0] ?? { marked: 0, unmarked: 0 };
      const posts = postsRow.rows[0] ?? { marked: 0, unmarked: 0 };
      return {
        seedMarked: { pages: pages.marked, posts: posts.marked },
        legacyUnmarked: { pages: pages.unmarked, posts: posts.unmarked },
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
