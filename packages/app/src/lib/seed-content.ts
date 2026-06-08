import { and, eq, sql } from "drizzle-orm";

import {
  deleteDocument,
  findDocuments,
  getCurrentSiteId,
  getDb,
  getRegisteredThemes,
  NP_DEFAULT_SITE_ID,
  npNavigation,
  saveDocument,
  type NpAuthUser,
  type NpNavItem,
  type NpRegisteredTheme,
  type NpTransaction,
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
  /** Outer transaction; see `WipeSeededOptions.tx` for semantics. */
  tx?: NpTransaction;
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
      { status: "published", tx: options.tx },
    );
  }
  for (const sample of categories) {
    await saveDocument(
      "categories",
      null,
      { name: sample.name, description: sample.description ?? "" },
      actor,
      { status: "published", tx: options.tx },
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

async function categoryIdsByName(): Promise<Map<string, string>> {
  const result = await findDocuments("categories", { limit: 50 });
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
  /** Outer transaction; see `WipeSeededOptions.tx` for semantics. */
  tx?: NpTransaction;
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
      where: { seedSource },
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

  // Use the outer tx for the slug-override raw UPDATE so it
  // joins the same atomic scope as the saveDocument writes.
  // Without an outer tx, fall back to the singleton db handle.
  const writeHandle = (options.tx ?? getDb()) as {
    execute(query: ReturnType<typeof sql>): Promise<unknown>;
  };
  for (const sample of pages) {
    const { slug, data: extraData, ...rest } = sample;
    // `extraData` (the `data` escape hatch) first, then `rest`
    // (the first-class slots) so a typed field on NpThemeSeedPage
    // always wins when both are set. Reverse order would let a
    // legacy `data: { template: "x" }` silently override the new
    // first-class `template` slot — wrong precedence.
    const payload: Record<string, unknown> = {
      ...(extraData ?? {}),
      ...rest,
    };
    if (seedSource) payload.seedSource = seedSource;
    const result = await saveDocument("pages", null, payload, actor, {
      status: "published",
      tx: options.tx,
    });
    if (slug) {
      const id = result.doc.id as string;
      // The pipeline's slugField derives from title, so we override
      // the home page's slug with a direct DB write after save.
      await writeHandle.execute(
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
  /** Outer transaction; see `WipeSeededOptions.tx` for semantics. */
  tx?: NpTransaction;
}

export async function seedPosts(
  actor: NpAuthUser,
  options: SeedPostsOptions = {},
): Promise<SeedPostsResult> {
  const seedSource = options.themeId ? `theme:${options.themeId}` : null;
  if (seedSource) {
    const existing = await findDocuments("posts", {
      where: { seedSource },
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

  const [tagIds, categoryIds] = await Promise.all([tagIdsByName(), categoryIdsByName()]);
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
  const writeHandle = (options.tx ?? getDb()) as {
    execute(query: ReturnType<typeof sql>): Promise<unknown>;
  };

  for (const sample of samples) {
    const tagRefs = (sample.tagNames ?? [])
      .map((name) => tagIds.get(name))
      .filter((id): id is string => typeof id === "string");
    const categoryRefs = (sample.categoryNames ?? [])
      .map((name) => categoryIds.get(name))
      .filter((id): id is string => typeof id === "string");
    const {
      tagNames: _tagNames,
      categoryNames: _categoryNames,
      status,
      slug,
      kind,
      parentSlug,
      order,
      data: extraData,
      ...rest
    } = sample;
    // `extraData` first, first-class slots second so a typed
    // field on NpThemeSeedPost always wins over a legacy
    // `data: { … }` setting the same key.
    const payload: Record<string, unknown> = {
      ...(extraData ?? {}),
      ...rest,
      author: actor.id,
      tags: tagRefs,
      categories: categoryRefs,
    };
    if (kind) payload.kind = kind;
    if (typeof order === "number") payload.order = order;
    if (seedSource) payload.seedSource = seedSource;
    const saved = await saveDocument(
      "posts",
      null,
      payload,
      actor,
      { status: status ?? "published", tx: options.tx },
    );
    const savedSlug =
      typeof saved.doc.slug === "string" ? saved.doc.slug : null;
    const savedId = typeof saved.doc.id === "string" ? saved.doc.id : null;
    if (slug && savedId) {
      await writeHandle.execute(
        sql`update np_c_posts set slug = ${slug} where id = ${savedId}`,
      );
    }
    const finalSlug = slug ?? savedSlug;
    if (finalSlug && savedId) slugToId.set(finalSlug, savedId);
    if (parentSlug && savedId) {
      pendingParents.push({ childId: savedId, parentSlug });
    }
  }

  // Pass 2: set the `parent` column on each child row. Goes through
  // raw SQL on purpose — `saveDocument(id, { parent })` would run a
  // partial-update payload through the pipeline's Zod schema, and
  // the schema validates the *patch* (not a merge with the existing
  // row) so required fields like `title` / `content` fail as
  // undefined. A pure-relationship column write doesn't need
  // hook fan-out (no search-vector recompute, no slug change), so
  // bypassing the pipeline here is correct.
  //
  // Use the outer tx (when provided) so the parent FK update joins
  // the same atomic scope as the saveDocument writes that created
  // the rows.
  for (const { childId, parentSlug } of pendingParents) {
    const parentId = slugToId.get(parentSlug);
    if (!parentId) continue;
    await writeHandle.execute(
      sql`update np_c_posts set parent = ${parentId} where id = ${childId}`,
    );
  }

  return { created: samples.length, skipped: false };
}

// ──────────────────────────────────────────────────────────────────
// Navigation — header + footer linking to the seeded pages.
// ──────────────────────────────────────────────────────────────────

export interface SeedNavigationOptions {
  header?: NpNavItem[];
  footer?: NpNavItem[];
  /** Outer transaction; see `WipeSeededOptions.tx` for semantics. */
  tx?: NpTransaction;
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
  // Use the outer tx for the existence reads + writes so they
  // join the same atomic scope as the rest of seedAll. Typed via
  // `getDb()`'s return type so the select / insert builder chains
  // resolve identically whether `tx` came from a transaction
  // callback or the pool.
  const dbHandle = (options.tx ?? getDb()) as unknown as ReturnType<typeof getDb>;

  const headerExisting = await dbHandle
    .select({ id: npNavigation.id })
    .from(npNavigation)
    .where(
      and(eq(npNavigation.siteId, siteId), eq(npNavigation.location, "header")),
    )
    .limit(1);

  const footerExisting = await dbHandle
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
    await dbHandle.insert(npNavigation).values({
      siteId,
      location: "header",
      items: headerItems,
      updatedAt: new Date(),
      updatedBy: actor.id,
    });
    headerCount = headerItems.length;
  }

  if (!footerSkipped) {
    await dbHandle.insert(npNavigation).values({
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
export interface SeedAllOptions {
  /** Outer transaction; see `WipeSeededOptions.tx` for semantics. */
  tx?: NpTransaction;
}

function hasThemeSeedContent(value: unknown): value is { seedContent?: NpThemeSeedContent } {
  return !!value && typeof value === "object";
}

export async function seedAll(
  actor: NpAuthUser,
  theme?: NpRegisteredTheme | null,
  options: SeedAllOptions = {},
): Promise<SeedAllResult> {
  // `NpRegisteredTheme.impl` is typed as opaque `unknown` in core
  // (themes opt into the typed `NpThemeImpl` view by importing
  // `@nexpress/theme`); narrow at the boundary so the seeder
  // sees the typed shape.
  const rawImpl = theme?.impl ?? null;
  const impl = hasThemeSeedContent(rawImpl) ? rawImpl : null;
  const themed: NpThemeSeedContent = impl?.seedContent ?? {};
  const themeId =
    typeof theme?.manifest?.id === "string" && theme.manifest.id.length > 0
      ? theme.manifest.id
      : null;

  const terms = await seedTerms(actor, {
    tags: themed.tags,
    categories: themed.categories,
    tx: options.tx,
  });
  const pages = await seedPages(actor, {
    pages: themed.pages,
    ...(themeId ? { themeId } : {}),
    tx: options.tx,
  });
  const posts = await seedPosts(actor, {
    posts: themed.posts,
    ...(themeId ? { themeId } : {}),
    tx: options.tx,
  });
  const nav = await seedNavigation(actor, {
    header: themed.navigation?.header,
    footer: themed.navigation?.footer,
    tx: options.tx,
  });
  return { terms, pages, posts, navigation: nav };
}

// ──────────────────────────────────────────────────────────────────
// Wipe — deletes seed-marked pages + posts so a theme switch can
// reseed without nuking operator-authored content. Goes through
// `deleteDocument` so beforeDelete / afterDelete hooks (cache
// busts, nav-cache invalidation, media-ref refcount drops) fire
// for every row.
//
// Two-phase shape so the wipe is atomic at the SQL layer:
//
//   1. Identify — call `findDocuments` against the live DB to
//      collect every (collection, id) matching the resolved
//      seed-source set. Reads only; no writes.
//   2. Delete — open one `db.transaction` and run
//      `deleteDocument(coll, id, actor, { tx })` for every id
//      inside it. Mid-loop failure rolls back ALL pending deletes
//      (the cascade for child / media-ref / comment / reaction /
//      report tables included).
//
// Post-commit hooks (`content:afterDelete` job + plugin hooks)
// still fire per-row inside the tx and their side-effects (cache
// busts, audit log writes against a separate connection, etc.)
// may diverge from the final DB state if the outer tx rolls back.
// In practice the operator re-runs the wipe, which fires the
// hooks a second time — and the canonical sources of truth they
// reflect (cache contents, derived counters) are idempotent under
// repeat invocation. The mid-loop-DB-failure case the user worries
// about — "I see N rows half-deleted and have no idea what
// state the site is in" — is now closed.
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
  /**
   * Outer transaction the wipe should run inside instead of opening
   * its own. The reseed POST handler uses this to bundle wipe +
   * setActiveThemeId + seedAll into one atomic transaction so a
   * mid-seed failure rolls back the wipe as well.
   */
  tx?: NpTransaction;
}

export interface WipeSeededResult {
  pagesDeleted: number;
  postsDeleted: number;
}

interface SeededTarget {
  collection: "pages" | "posts";
  id: string;
  parentId?: string | null;
}

function readSeededParentId(parent: unknown): string | null {
  if (typeof parent === "string") return parent;
  if (parent && typeof parent === "object" && "id" in parent) {
    const id = (parent as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function orderSeededTargetsForDelete(targets: SeededTarget[]): SeededTarget[] {
  const byId = new Map(
    targets.filter((t) => t.collection === "posts").map((t) => [t.id, t]),
  );
  const depthCache = new Map<string, number>();

  const depth = (target: SeededTarget, visiting = new Set<string>()): number => {
    if (target.collection !== "posts") return 0;
    const cached = depthCache.get(target.id);
    if (cached !== undefined) return cached;
    if (visiting.has(target.id)) return 0;
    const parent = target.parentId ? byId.get(target.parentId) : undefined;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(target.id);
    const value = parent ? depth(parent, nextVisiting) + 1 : 0;
    depthCache.set(target.id, value);
    return value;
  };

  return [...targets].sort((a, b) => {
    if (a.collection !== b.collection) return a.collection === "posts" ? -1 : 1;
    return depth(b) - depth(a);
  });
}

/**
 * Identify every (collection, id) matching the resolved seed-
 * source set. Reads only — no writes happen here. The cap is set
 * high because a "wipe everything seeded" against a normal install
 * is ~tens of rows, not hundreds; for a hypothetical install with
 * thousands the cap should fire and the operator should reseed
 * after a manual cleanup instead.
 */
async function collectSeededTargets(
  themeIds: string[],
): Promise<SeededTarget[]> {
  const targets: SeededTarget[] = [];
  for (const themeId of themeIds) {
    const seedSource = `theme:${themeId}`;
    for (const collection of ["pages", "posts"] as const) {
      const result = await findDocuments<{ id: string; seedSource?: string; parent?: unknown }>(
        collection,
        { where: { seedSource }, limit: 10_000 },
      );
      for (const doc of result.docs) {
        if (typeof doc.id === "string") {
          targets.push({
            collection,
            id: doc.id,
            parentId: collection === "posts" ? readSeededParentId(doc.parent) : null,
          });
        }
      }
    }
  }
  return orderSeededTargetsForDelete(targets);
}

export async function wipeSeededContent(
  actor: NpAuthUser,
  options: WipeSeededOptions = {},
): Promise<WipeSeededResult> {
  // Resolve the set of seed_source values to delete. When the
  // caller passes a themeId, we wipe just that theme's rows. When
  // omitted, walk every registered theme — covers the common case
  // of "wipe all framework seed before reseeding" without a
  // `seedSource IS NOT NULL` predicate (which isn't part of v0.1
  // FindOptions and would require a contract extension).
  //
  // Orphaned rows from a theme that has since been uninstalled
  // stay on disk; the operator deletes them manually. Acceptable
  // because reseed callers always pass the active theme registry,
  // so uninstall is the only way to land in that state.
  const themeIds = options.themeId
    ? [options.themeId]
    : getRegisteredThemes().map((t) => t.manifest.id);

  const targets = await collectSeededTargets(themeIds);
  if (targets.length === 0) {
    return { pagesDeleted: 0, postsDeleted: 0 };
  }

  let pagesDeleted = 0;
  let postsDeleted = 0;

  // Run every per-row deleteDocument against the same tx — either
  // the caller's outer tx (reseed POST bundling wipe + seed) or a
  // private one opened here. Both variants give the wipe atomic
  // SQL semantics; the outer-tx variant additionally lets a later
  // seed failure roll back the wipe.
  const deleteAll = async (tx: NpTransaction): Promise<void> => {
    for (const { collection, id } of targets) {
      await deleteDocument(collection, id, actor, { tx });
      if (collection === "pages") pagesDeleted += 1;
      else postsDeleted += 1;
    }
  };
  if (options.tx) {
    await deleteAll(options.tx);
  } else {
    const db = getDb();
    await db.transaction(async (tx) => {
      await deleteAll(tx as unknown as NpTransaction);
    });
  }

  return { pagesDeleted, postsDeleted };
}
