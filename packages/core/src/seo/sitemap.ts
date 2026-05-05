import { getAllCollectionSlugs, getCollectionConfig } from "../collections/registry.js";
import { findDocuments } from "../collections/pipeline.js";
import { getI18nConfig } from "../i18n/registry.js";

/**
 * Phase 10.1 — sitemap entry shape. Mirrors the sitemap.org spec
 * fields the framework cares about. Apps format these into XML
 * (the reference app does that in `apps/web/src/app/sitemap.xml/
 * route.ts`); the core helper stays format-agnostic so a future
 * news-sitemap or video-sitemap variant can reuse the same
 * collection walk.
 */
export interface NpSitemapEntry {
  /** Path-only — host is prepended by the consumer. Always starts with `/`. */
  loc: string;
  /** ISO timestamp for `<lastmod>`. Falls back to `updatedAt` then `createdAt`. */
  lastmod?: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
  /**
   * Phase 12.2 — hreflang alternates for translated content.
   * The renderer emits an `<xhtml:link rel="alternate" hreflang="..." href="..."/>`
   * entry per alternate, and the urlset gets the xhtml namespace
   * declaration when any entry uses alternates.
   */
  alternates?: Array<{ hreflang: string; href: string }>;
}

export interface BuildSitemapOptions {
  /**
   * Cap per-collection at this many rows so a 100K-document blog
   * doesn't bring the sitemap.xml endpoint to its knees. Default
   * 5000 is the sitemaps.org recommended max per file. Sites with
   * more rows than that per locale should pair this with the
   * sitemap-index split (see `locale` below) so each child file
   * stays under the cap.
   */
  perCollectionLimit?: number;
  /** Restrict to specific collection slugs (default: all). */
  collections?: string[];
  /**
   * Restrict to a single locale. When set:
   *   - i18n collections filter rows to `locale = $locale` (so
   *     each per-locale sitemap only enumerates its own URLs).
   *   - non-i18n collections are emitted only for the configured
   *     `defaultLocale`; other locales' sitemaps skip them so
   *     a row never appears in two sibling sitemaps.
   * Leaving this `undefined` keeps the unfiltered single-file
   * behavior used when i18n is not configured.
   */
  locale?: string;
}

/**
 * Sitemap-index entry — a pointer to a child `<urlset>` document
 * (typically a per-locale sitemap). The `loc` is path-only; the
 * renderer prepends the absolute origin.
 */
export interface NpSitemapIndexEntry {
  loc: string;
  /** Optional ISO timestamp for `<lastmod>` on the child sitemap. */
  lastmod?: string;
}

const DEFAULT_LIMIT_PER_COLLECTION = 5_000;

/**
 * Walks every registered collection that opts into the sitemap
 * via `seo.urlPath`, queries published documents, and emits a
 * flat list of `NpSitemapEntry` rows. Anonymous read access is
 * required — `findDocuments(slug, opts, undefined)` runs the
 * collection's `access.read` callback with no user. Collections
 * that gate reads (admin-only, member-only) won't surface in the
 * sitemap, which is the right default.
 *
 * The function intentionally doesn't include the site root `/`
 * by itself — sites add a fixed entry for the home page (and any
 * other static routes like /search, /discussions) on top of the
 * collection walk.
 */
export async function buildSitemap(
  options: BuildSitemapOptions = {},
): Promise<NpSitemapEntry[]> {
  const limit = options.perCollectionLimit ?? DEFAULT_LIMIT_PER_COLLECTION;
  const slugs = options.collections ?? getAllCollectionSlugs();
  const entries: NpSitemapEntry[] = [];
  const i18n = getI18nConfig();
  const localeFilter = options.locale;

  for (const slug of slugs) {
    let config;
    try {
      config = getCollectionConfig(slug);
    } catch {
      continue;
    }
    const seo = config.seo;
    if (!seo?.urlPath) continue;

    // Phase 12.9 — per-locale sitemap split. When the caller
    // requests a specific locale, non-i18n collections only
    // surface in the default-locale sitemap so a row never
    // appears in two sibling sitemaps.
    if (localeFilter && !config.i18n) {
      if (!i18n || localeFilter !== i18n.defaultLocale) continue;
    }

    let result;
    try {
      result = await findDocuments(
        slug,
        {
          limit,
          page: 1,
          where: { status: "published" },
          // For i18n collections we deliberately fetch *every*
          // locale's rows even when a localeFilter is set so the
          // grouping pass below can still build a complete
          // hreflang-alternates list. The emission step further
          // down filters siblings to the requested locale before
          // pushing entries. Non-i18n collections take the
          // localeFilter path through the early `continue` above.
        },
        // Anonymous — `access.read` must allow it for the row to
        // appear. Collections gated to authenticated users won't
        // throw here because the access check runs on the
        // collection level (not per-row); they'll throw and we
        // skip below.
        undefined,
      );
    } catch {
      continue;
    }

    // Phase 12.2 — for i18n collections, group rows by
    // translationGroupId so each emitted entry can advertise
    // its hreflang alternates. Rows missing the group id
    // (shouldn't happen post-12.1) fall back to standalone
    // entries with no alternates.
    const docs = result.docs;
    if (config.i18n) {
      const groups = new Map<string, Array<Record<string, unknown>>>();
      const orphans: Array<Record<string, unknown>> = [];
      for (const doc of docs) {
        const groupId =
          typeof doc.translationGroupId === "string"
            ? doc.translationGroupId
            : null;
        if (!groupId) {
          orphans.push(doc);
          continue;
        }
        const list = groups.get(groupId);
        if (list) list.push(doc);
        else groups.set(groupId, [doc]);
      }
      for (const siblings of groups.values()) {
        const alternates: Array<{ hreflang: string; href: string }> = [];
        for (const sibling of siblings) {
          const siblingPath = seo.urlPath(sibling);
          const locale =
            typeof sibling.locale === "string" ? sibling.locale : null;
          if (siblingPath && locale) {
            alternates.push({ hreflang: locale, href: siblingPath });
          }
        }
        for (const sibling of siblings) {
          // Phase 12.9 — when emitting a per-locale sitemap, only
          // push the sibling whose locale matches the filter; the
          // alternates list still references every translation
          // (built above) so crawlers discover the others through
          // hreflang.
          if (localeFilter) {
            const siblingLocale =
              typeof sibling.locale === "string" ? sibling.locale : null;
            if (siblingLocale !== localeFilter) continue;
          }
          const path = seo.urlPath(sibling);
          if (!path || !path.startsWith("/")) continue;
          entries.push({
            loc: path,
            lastmod: pickLastmod(sibling),
            changefreq: seo.changefreq,
            priority: seo.priority,
            alternates: alternates.length > 1 ? alternates : undefined,
          });
        }
      }
      for (const doc of orphans) {
        if (localeFilter) {
          const docLocale = typeof doc.locale === "string" ? doc.locale : null;
          if (docLocale !== localeFilter) continue;
        }
        const path = seo.urlPath(doc);
        if (!path || !path.startsWith("/")) continue;
        entries.push({
          loc: path,
          lastmod: pickLastmod(doc),
          changefreq: seo.changefreq,
          priority: seo.priority,
        });
      }
      continue;
    }

    for (const doc of docs) {
      const path = seo.urlPath(doc);
      if (!path) continue;
      if (!path.startsWith("/")) continue;
      entries.push({
        loc: path,
        lastmod: pickLastmod(doc),
        changefreq: seo.changefreq,
        priority: seo.priority,
      });
    }
  }

  return entries;
}

function pickLastmod(doc: Record<string, unknown>): string | undefined {
  const candidate = doc.updatedAt ?? doc.createdAt;
  if (candidate instanceof Date) return candidate.toISOString();
  if (typeof candidate === "string") {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

/**
 * Renders an `NpSitemapEntry[]` plus the absolute host into an
 * XML body suitable for `Content-Type: application/xml`. The
 * loc path is URL-joined with the host without double-slashes;
 * the host should NOT have a trailing slash. The output is
 * sitemap.org 0.9 compliant.
 */
export function renderSitemapXml(
  origin: string,
  entries: NpSitemapEntry[],
): string {
  const trimmed = origin.replace(/\/+$/, "");
  const usesAlternates = entries.some(
    (e) => e.alternates && e.alternates.length > 0,
  );
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    usesAlternates
      ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
      : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(`${trimmed}${entry.loc}`)}</loc>`);
    if (entry.lastmod) {
      lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    }
    if (entry.changefreq) {
      lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    }
    if (typeof entry.priority === "number") {
      lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    if (entry.alternates) {
      for (const alt of entry.alternates) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(`${trimmed}${alt.href}`)}"/>`,
        );
      }
    }
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return lines.join("\n");
}

/**
 * Phase 12.9 — render a sitemap-index document. Sites with i18n
 * configured emit one of these at `/sitemap.xml` instead of a
 * single `<urlset>`; each child sitemap holds the URLs for one
 * locale so the per-file 50K-entry sitemaps.org cap is per-locale
 * rather than shared across the whole site.
 *
 * The index itself is small (one `<sitemap>` per locale) so it
 * doesn't need the `xhtml` namespace or alternates — those live
 * inside the child `<urlset>` documents.
 */
export function renderSitemapIndexXml(
  origin: string,
  entries: NpSitemapIndexEntry[],
): string {
  const trimmed = origin.replace(/\/+$/, "");
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <sitemap>");
    lines.push(`    <loc>${escapeXml(`${trimmed}${entry.loc}`)}</loc>`);
    if (entry.lastmod) {
      lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    }
    lines.push("  </sitemap>");
  }
  lines.push("</sitemapindex>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
