import { getAllCollectionSlugs, getCollectionConfig } from "../collections/registry.js";
import { findDocuments } from "../collections/pipeline.js";
import { getI18nConfig } from "../i18n/registry.js";
import {
  NpSeoContractError,
  npRequireSeoOrigin,
  npRequireSeoPath,
  npRequireSitemapEntries,
  npRequireSitemapIndexEntries,
  npRequireSitemapOptions,
  npSeoContractLimits,
} from "./contract.js";
import type { BuildSitemapOptions, NpSitemapEntry, NpSitemapIndexEntry } from "./types.js";
import { npPublicCommunityAudienceWhere } from "../community/audience.js";

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
): Promise<readonly NpSitemapEntry[]> {
  const parsedOptions = npRequireSitemapOptions(options);
  const limit = parsedOptions.perCollectionLimit ?? DEFAULT_LIMIT_PER_COLLECTION;
  const slugs = parsedOptions.collections ?? getAllCollectionSlugs();
  const entries: NpSitemapEntry[] = [];
  const i18n = getI18nConfig();
  const localeFilter = parsedOptions.locale;

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
          where: { status: "published", ...npPublicCommunityAudienceWhere(config) },
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
        const groupId = typeof doc.translationGroupId === "string" ? doc.translationGroupId : null;
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
          const locale = typeof sibling.locale === "string" ? sibling.locale : null;
          if (siblingPath !== null && locale) {
            alternates.push({ hreflang: locale, href: npRequireSeoPath(siblingPath) });
          }
        }
        for (const sibling of siblings) {
          // Phase 12.9 — when emitting a per-locale sitemap, only
          // push the sibling whose locale matches the filter; the
          // alternates list still references every translation
          // (built above) so crawlers discover the others through
          // hreflang.
          if (localeFilter) {
            const siblingLocale = typeof sibling.locale === "string" ? sibling.locale : null;
            if (siblingLocale !== localeFilter) continue;
          }
          const rawPath = seo.urlPath(sibling);
          if (rawPath === null) continue;
          const path = npRequireSeoPath(rawPath);
          const lastmod = pickLastmod(sibling);
          entries.push({
            loc: path,
            ...(lastmod ? { lastmod } : {}),
            ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
            ...(typeof seo.priority === "number" ? { priority: seo.priority } : {}),
            ...(alternates.length > 1 ? { alternates } : {}),
          });
        }
      }
      for (const doc of orphans) {
        if (localeFilter) {
          const docLocale = typeof doc.locale === "string" ? doc.locale : null;
          if (docLocale !== localeFilter) continue;
        }
        const rawPath = seo.urlPath(doc);
        if (rawPath === null) continue;
        const path = npRequireSeoPath(rawPath);
        const lastmod = pickLastmod(doc);
        entries.push({
          loc: path,
          ...(lastmod ? { lastmod } : {}),
          ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
          ...(typeof seo.priority === "number" ? { priority: seo.priority } : {}),
        });
      }
      continue;
    }

    for (const doc of docs) {
      const rawPath = seo.urlPath(doc);
      if (rawPath === null) continue;
      const path = npRequireSeoPath(rawPath);
      const lastmod = pickLastmod(doc);
      entries.push({
        loc: path,
        ...(lastmod ? { lastmod } : {}),
        ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
        ...(typeof seo.priority === "number" ? { priority: seo.priority } : {}),
      });
    }
  }

  return npRequireSitemapEntries(entries);
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
export function renderSitemapXml(origin: string, entries: readonly NpSitemapEntry[]): string {
  const parsedOrigin = npRequireSeoOrigin(origin);
  const parsedEntries = npRequireSitemapEntries(entries);
  const usesAlternates = parsedEntries.some((e) => e.alternates && e.alternates.length > 0);
  function* xmlLines(): Generator<string> {
    yield '<?xml version="1.0" encoding="UTF-8"?>';
    yield usesAlternates
      ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
      : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    for (const entry of parsedEntries) {
      yield "  <url>";
      yield `    <loc>${escapeXml(`${parsedOrigin}${entry.loc}`)}</loc>`;
      if (entry.lastmod) {
        yield `    <lastmod>${entry.lastmod}</lastmod>`;
      }
      if (entry.changefreq) {
        yield `    <changefreq>${entry.changefreq}</changefreq>`;
      }
      if (typeof entry.priority === "number") {
        yield `    <priority>${entry.priority.toFixed(1)}</priority>`;
      }
      if (entry.alternates) {
        for (const alt of entry.alternates) {
          yield `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(`${parsedOrigin}${alt.href}`)}"/>`;
        }
      }
      yield "  </url>";
    }
    yield "</urlset>";
  }
  return npJoinSitemapXmlLines(xmlLines());
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
  entries: readonly NpSitemapIndexEntry[],
): string {
  const parsedOrigin = npRequireSeoOrigin(origin);
  const parsedEntries = npRequireSitemapIndexEntries(entries);
  function* xmlLines(): Generator<string> {
    yield '<?xml version="1.0" encoding="UTF-8"?>';
    yield '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    for (const entry of parsedEntries) {
      yield "  <sitemap>";
      yield `    <loc>${escapeXml(`${parsedOrigin}${entry.loc}`)}</loc>`;
      if (entry.lastmod) {
        yield `    <lastmod>${entry.lastmod}</lastmod>`;
      }
      yield "  </sitemap>";
    }
    yield "</sitemapindex>";
  }
  return npJoinSitemapXmlLines(xmlLines());
}

/** Internal line joiner shared by both sitemap renderers. */
export function npJoinSitemapXmlLines(
  lines: Iterable<string>,
  maximumBytes: number = npSeoContractLimits.maxSitemapXmlBytes,
): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }
  const output: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    bytes += Buffer.byteLength(line, "utf8") + (output.length === 0 ? 0 : 1);
    if (bytes > maximumBytes) {
      const message = `rendered sitemap XML may contain at most ${maximumBytes.toString()} UTF-8 bytes.`;
      throw new NpSeoContractError(`Invalid sitemap XML: sitemapXml: ${message}`, [
        {
          code: "max-bytes",
          path: "sitemapXml",
          message,
        },
      ]);
    }
    output.push(line);
  }
  return output.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
