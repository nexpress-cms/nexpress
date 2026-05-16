import { and, eq, sql } from "drizzle-orm";

import {
  deleteDocument,
  findDocuments,
  getCurrentSiteId,
  getDb,
  NP_DEFAULT_SITE_ID,
  npNavigation,
  saveDocument,
  type NpAuthUser,
  type NpNavItem,
  type NpRegisteredTheme,
} from "@nexpress/core";
import type {
  NpThemeSeedContent,
  NpThemeSeedPage,
  NpThemeSeedPost,
  NpThemeSeedTerm,
} from "@nexpress/theme";

/**
 * Demo-content seeders shared by the CLI script (`pnpm seed:content`)
 * and the first-boot Admin Setup wizard (#A, follow-up to #396).
 *
 * Idempotent — each function checks for an existing row first and
 * is a no-op when content already exists. Callers wrap in
 * `withCurrentSite(siteId, …)` when targeting a non-default tenant;
 * the navigation seeder reads `getCurrentSiteId()` so the row is
 * stamped explicitly.
 *
 * `console.log` lives at the call site; this module only returns
 * counts so an HTTP handler can render structured progress.
 *
 * The pages seeded here are composed out of the framework's
 * built-in block library (hero / section-header / feature-grid /
 * stats-grid / testimonials / tabs / pricing / faq / cta /
 * logos-cloud) so the home page actually exercises the page
 * builder out of the box, rather than emitting a single
 * rich-text dump that hides every block primitive.
 */

export interface SeedPagesResult {
  created: number;
  skipped: boolean;
}

export interface SeedPostsResult {
  created: number;
  skipped: boolean;
}

export interface SeedTermsResult {
  tagsCreated: number;
  categoriesCreated: number;
  skipped: boolean;
}

export interface SeedNavigationResult {
  header: number;
  footer: number;
  headerSkipped: boolean;
  footerSkipped: boolean;
}

export interface SeedAllResult {
  terms: SeedTermsResult;
  pages: SeedPagesResult;
  posts: SeedPostsResult;
  navigation: SeedNavigationResult;
}

// ──────────────────────────────────────────────────────────────────
// Tags — seeded before posts so each post can reference real ids.
// ──────────────────────────────────────────────────────────────────

export interface SeedTermsOptions {
  tags?: NpThemeSeedTerm[];
  categories?: NpThemeSeedTerm[];
}

export async function seedTerms(
  actor: NpAuthUser,
  options: SeedTermsOptions = {},
): Promise<SeedTermsResult> {
  const tags = options.tags ?? [];
  const categories = options.categories ?? [];
  if (tags.length === 0 && categories.length === 0) {
    return { tagsCreated: 0, categoriesCreated: 0, skipped: true };
  }

  // Both collections are checked together — if the operator has
  // touched EITHER side, treat the seed as already-run so we don't
  // half-overwrite.
  const tagsExisting = await findDocuments("tags", { limit: 1 });
  const categoriesExisting = await findDocuments("categories", { limit: 1 });
  if (tagsExisting.docs.length > 0 || categoriesExisting.docs.length > 0) {
    return { tagsCreated: 0, categoriesCreated: 0, skipped: true };
  }

  for (const sample of tags) {
    await saveDocument(
      "tags",
      null,
      { name: sample.name, description: sample.description ?? "" },
      actor,
      { status: "published" },
    );
  }
  for (const sample of categories) {
    await saveDocument(
      "categories",
      null,
      { name: sample.name, description: sample.description ?? "" },
      actor,
      { status: "published" },
    );
  }
  return {
    tagsCreated: tags.length,
    categoriesCreated: categories.length,
    skipped: false,
  };
}

async function tagIdsByName(): Promise<Map<string, string>> {
  const result = await findDocuments("tags", { limit: 50 });
  const ids = new Map<string, string>();
  for (const doc of result.docs) {
    const name = typeof doc.name === "string" ? doc.name : null;
    const id = typeof doc.id === "string" ? doc.id : null;
    if (name && id) ids.set(name, id);
  }
  return ids;
}

export interface SeedPagesOptions {
  pages?: NpThemeSeedPage[];
  /**
   * Theme that owns this seed. Stamped onto every created row as
   * `seedSource = "theme:{themeId}"` so a later reseed can wipe just
   * the seed-marked rows without touching operator-authored content.
   * When omitted, rows are still seeded but carry no marker — only
   * useful for one-off CLI tests; the admin seed flow always supplies
   * a themeId.
   */
  themeId?: string;
}

export async function seedPages(
  actor: NpAuthUser,
  options: SeedPagesOptions = {},
): Promise<SeedPagesResult> {
  const pages = options.pages ?? [];
  if (pages.length === 0) {
    return { created: 0, skipped: true };
  }
  const seedSource = options.themeId ? `theme:${options.themeId}` : null;

  // Per-theme idempotency: if a row with this seedSource already
  // exists, the seeder has run before for this theme — skip. Lets
  // first-boot run once and later reseed (which wipes first) re-run
  // cleanly, while keeping operator-authored rows untouched.
  if (seedSource) {
    const existing = await findDocuments("pages", {
      where: { seedSource } as Record<string, unknown>,
      limit: 1,
    });
    if (existing.docs.length > 0) {
      return { created: 0, skipped: true };
    }
  } else {
    const existing = await findDocuments("pages", { limit: 1 });
    if (existing.docs.length > 0) {
      return { created: 0, skipped: true };
    }
  }

  const db = getDb();
  for (const sample of pages) {
    const { slug, data: extraData, ...rest } = sample;
    const payload: Record<string, unknown> = {
      ...rest,
      ...(extraData ?? {}),
    };
    if (seedSource) payload.seedSource = seedSource;
    const result = await saveDocument("pages", null, payload, actor, {
      status: "published",
    });
    if (slug) {
      const id = result.doc.id as string;
      // The pipeline's slugField derives from title, so we override
      // the home page's slug with a direct DB write after save.
      await db.execute(
        sql`update np_c_pages set slug = ${slug} where id = ${id}`,
      );
    }
  }
  return { created: pages.length, skipped: false };
}



export interface SeedPostsOptions {
  posts?: NpThemeSeedPost[];
  /** Theme that owns this seed. See `SeedPagesOptions.themeId`. */
  themeId?: string;
}

export async function seedPosts(
  actor: NpAuthUser,
  options: SeedPostsOptions = {},
): Promise<SeedPostsResult> {
  const seedSource = options.themeId ? `theme:${options.themeId}` : null;
  if (seedSource) {
    const existing = await findDocuments("posts", {
      where: { seedSource } as Record<string, unknown>,
      limit: 1,
    });
    if (existing.docs.length > 0) {
      return { created: 0, skipped: true };
    }
  } else {
    const existing = await findDocuments("posts", { limit: 1 });
    if (existing.docs.length > 0) {
      return { created: 0, skipped: true };
    }
  }

  const tagIds = await tagIdsByName();
  const samples = options.posts ?? [];
  if (samples.length === 0) {
    return { created: 0, skipped: true };
  }

  // Two-pass write to support `parentSlug` references across the
  // seeded batch: pass 1 writes every row with parent=null and
  // records the slug→id mapping; pass 2 updates rows whose
  // `parentSlug` resolves to a real id. Article-kind posts (no
  // parentSlug) ignore the second pass.
  const slugToId = new Map<string, string>();
  const pendingParents: Array<{ childId: string; parentSlug: string }> = [];

  for (const sample of samples) {
    const tagRefs = (sample.tagNames ?? [])
      .map((name) => tagIds.get(name))
      .filter((id): id is string => typeof id === "string");
    const {
      tagNames: _tagNames,
      status,
      kind,
      parentSlug,
      order,
      data: extraData,
      ...rest
    } = sample;
    const payload: Record<string, unknown> = {
      ...rest,
      ...(extraData ?? {}),
      author: actor.id,
      tags: tagRefs,
    };
    if (kind) payload.kind = kind;
    if (typeof order === "number") payload.order = order;
    if (seedSource) payload.seedSource = seedSource;
    const saved = await saveDocument(
      "posts",
      null,
      payload,
      actor,
      { status: status ?? "published" },
    );
    const savedSlug =
      typeof saved.doc.slug === "string" ? saved.doc.slug : null;
    const savedId = typeof saved.doc.id === "string" ? saved.doc.id : null;
    if (savedSlug && savedId) slugToId.set(savedSlug, savedId);
    if (parentSlug && savedId) {
      pendingParents.push({ childId: savedId, parentSlug });
    }
  }

  for (const { childId, parentSlug } of pendingParents) {
    const parentId = slugToId.get(parentSlug);
    if (!parentId) continue;
    await saveDocument("posts", childId, { parent: parentId }, actor);
  }

  return { created: samples.length, skipped: false };
}

// ──────────────────────────────────────────────────────────────────
// Navigation — header + footer linking to the seeded pages.
// ──────────────────────────────────────────────────────────────────

export interface SeedNavigationOptions {
  header?: NpNavItem[];
  footer?: NpNavItem[];
}

export async function seedNavigation(
  actor: NpAuthUser,
  options: SeedNavigationOptions = {},
): Promise<SeedNavigationResult> {
  const headerItems = options.header ?? [];
  const footerItems = options.footer ?? [];
  if (headerItems.length === 0 && footerItems.length === 0) {
    return {
      header: 0,
      footer: 0,
      headerSkipped: true,
      footerSkipped: true,
    };
  }

  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const db = getDb();

  const headerExisting = await db
    .select({ id: npNavigation.id })
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, "header")),
    )
    .limit(1);

  const footerExisting = await db
    .select({ id: npNavigation.id })
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, "footer")),
    )
    .limit(1);

  let headerCount = 0;
  let footerCount = 0;
  const headerSkipped = headerExisting.length > 0;
  const footerSkipped = footerExisting.length > 0;

  if (!headerSkipped) {
    await db.insert(npNavigation).values({
      siteId,
      location: "header",
      items: headerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    headerCount = headerItems.length;
  }

  if (!footerSkipped) {
    await db.insert(npNavigation).values({
      siteId,
      location: "footer",
      items: footerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    footerCount = footerItems.length;
  }

  return {
    header: headerCount,
    footer: footerCount,
    headerSkipped,
    footerSkipped,
  };
}

// ──────────────────────────────────────────────────────────────────
// Orchestrator — terms first so post tag/category refs resolve.
// ──────────────────────────────────────────────────────────────────

/**
 * Theme-aware seed orchestrator.
 *
 * Reads every fixture (`pages`, `posts`, `tags`, `categories`,
 * `navigation`) from `theme.impl.seedContent`. The framework keeps
 * no demo content — themes own theirs. Pass no `theme` (or one
 * without `seedContent`) and every slot no-ops.
 *
 * Idempotency is **per-theme**, keyed on `seed_source = "theme:{id}"`:
 *
 *   - First run for theme A → seedPages/seedPosts write rows stamped
 *     `theme:A`.
 *   - Second run for theme A → finds existing rows with the marker,
 *     skips with `skipped: true`.
 *   - Run for theme B without a prior wipe → finds no rows with
 *     marker `theme:B`, writes B's rows alongside A's (8 pages
 *     total). Use `wipeSeededContent(actor)` first if you want
 *     replacement semantics — the admin reseed UI
 *     (`/api/admin/themes/reseed`) does exactly this.
 *
 * Operator-authored rows (no `seed_source`) are never touched.
 */
export async function seedAll(
  actor: NpAuthUser,
  theme?: NpRegisteredTheme | null,
): Promise<SeedAllResult> {
  // `NpRegisteredTheme.impl` is typed as opaque `unknown` in core
  // (themes opt into the typed `NpThemeImpl` view by importing
  // `@nexpress/theme`); narrow at the boundary so the seeder
  // sees the typed shape. The structural cast is benign — both
  // sides go through the `defineTheme` author surface.
  const impl = (theme?.impl ?? null) as { seedContent?: NpThemeSeedContent } | null;
  const themed: NpThemeSeedContent = impl?.seedContent ?? {};
  const themeId =
    typeof theme?.manifest?.id === "string" && theme.manifest.id.length > 0
      ? theme.manifest.id
      : null;

  const terms = await seedTerms(actor, {
    tags: themed.tags,
    categories: themed.categories,
  });
  const pages = await seedPages(actor, {
    pages: themed.pages,
    ...(themeId ? { themeId } : {}),
  });
  const posts = await seedPosts(actor, {
    posts: themed.posts,
    ...(themeId ? { themeId } : {}),
  });
  const nav = await seedNavigation(actor, {
    header: themed.navigation?.header,
    footer: themed.navigation?.footer,
  });
  return { terms, pages, posts, navigation: nav };
}

// ──────────────────────────────────────────────────────────────────
// Wipe — deletes seed-marked pages + posts so a theme switch can
// reseed without nuking operator-authored content. Goes through
// `deleteDocument` so beforeDelete / afterDelete hooks (cache
// busts, nav-cache invalidation, media-ref refcount drops) fire
// for every row. Slower than a raw SQL delete; right for ~tens of
// rows where correctness beats throughput.
// ──────────────────────────────────────────────────────────────────

export interface WipeSeededOptions {
  /**
   * Restrict the wipe to rows seeded by this theme id. When omitted,
   * every row carrying any seedSource value is deleted. The admin's
   * reseed flow passes the *outgoing* theme id so a switch from
   * magazine → portfolio only deletes magazine's seed (portfolio's
   * may not exist yet; the subsequent seed call writes it).
   */
  themeId?: string;
}

export interface WipeSeededResult {
  pagesDeleted: number;
  postsDeleted: number;
}

export async function wipeSeededContent(
  actor: NpAuthUser,
  options: WipeSeededOptions = {},
): Promise<WipeSeededResult> {
  const where = options.themeId
    ? ({ seedSource: `theme:${options.themeId}` } as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  let pagesDeleted = 0;
  let postsDeleted = 0;

  // Pages first — no FK ordering constraint between pages/posts, but
  // pages tend to be fewer rows so they finish quickly and a partial
  // failure leaves the larger posts wipe pending rather than the
  // other way around.
  const pageRows = await findDocuments<{ id: string; seedSource?: string }>(
    "pages",
    {
      ...(options.themeId ? { where } : {}),
      limit: 500,
    },
  );
  for (const page of pageRows.docs) {
    if (!options.themeId && !page.seedSource) continue;
    if (typeof page.id !== "string") continue;
    await deleteDocument("pages", page.id, actor);
    pagesDeleted += 1;
  }

  // Posts — include drafts and scheduled (the seeder writes a future-
  // dated draft as part of the marketing-blog demo). The pipeline's
  // default findDocuments doesn't filter by status, so the cap of 500
  // is the only bound here.
  const postRows = await findDocuments<{ id: string; seedSource?: string }>(
    "posts",
    {
      ...(options.themeId ? { where } : {}),
      limit: 500,
    },
  );
  for (const post of postRows.docs) {
    if (!options.themeId && !post.seedSource) continue;
    if (typeof post.id !== "string") continue;
    await deleteDocument("posts", post.id, actor);
    postsDeleted += 1;
  }

  return { pagesDeleted, postsDeleted };
}
