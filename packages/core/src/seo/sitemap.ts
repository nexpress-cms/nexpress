import { getAllCollectionSlugs, getCollectionConfig } from "../collections/registry.js";
import { findDocuments } from "../collections/pipeline.js";

/**
 * Phase 10.1 — sitemap entry shape. Mirrors the sitemap.org spec
 * fields the framework cares about. Apps format these into XML
 * (the reference app does that in `apps/web/src/app/sitemap.xml/
 * route.ts`); the core helper stays format-agnostic so a future
 * news-sitemap or video-sitemap variant can reuse the same
 * collection walk.
 */
export interface NxSitemapEntry {
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
}

export interface BuildSitemapOptions {
  /**
   * Cap per-collection at this many rows so a 100K-document blog
   * doesn't bring the sitemap.xml endpoint to its knees. Sites with
   * more rows should split into multiple sitemaps via a sitemap
   * index — that's a follow-up. Default 5000 is the sitemaps.org
   * recommended max per file.
   */
  perCollectionLimit?: number;
  /** Restrict to specific collection slugs (default: all). */
  collections?: string[];
}

const DEFAULT_LIMIT_PER_COLLECTION = 5_000;

/**
 * Walks every registered collection that opts into the sitemap
 * via `seo.urlPath`, queries published documents, and emits a
 * flat list of `NxSitemapEntry` rows. Anonymous read access is
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
): Promise<NxSitemapEntry[]> {
  const limit = options.perCollectionLimit ?? DEFAULT_LIMIT_PER_COLLECTION;
  const slugs = options.collections ?? getAllCollectionSlugs();
  const entries: NxSitemapEntry[] = [];

  for (const slug of slugs) {
    let config;
    try {
      config = getCollectionConfig(slug);
    } catch {
      continue;
    }
    const seo = config.seo;
    if (!seo?.urlPath) continue;

    let result;
    try {
      result = await findDocuments(
        slug,
        { limit, page: 1, where: { status: "published" } },
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

    for (const doc of result.docs) {
      const path = seo.urlPath(doc as Record<string, unknown>);
      if (!path) continue;
      if (!path.startsWith("/")) continue;
      entries.push({
        loc: path,
        lastmod: pickLastmod(doc as Record<string, unknown>),
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
 * Renders an `NxSitemapEntry[]` plus the absolute host into an
 * XML body suitable for `Content-Type: application/xml`. The
 * loc path is URL-joined with the host without double-slashes;
 * the host should NOT have a trailing slash. The output is
 * sitemap.org 0.9 compliant.
 */
export function renderSitemapXml(
  origin: string,
  entries: NxSitemapEntry[],
): string {
  const trimmed = origin.replace(/\/+$/, "");
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
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
    lines.push("  </url>");
  }
  lines.push("</urlset>");
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
