import { findDocuments } from "../collections/pipeline.js";
import { getCollectionConfig } from "../collections/registry.js";

import { getSiteSeoSettings } from "./page-metadata.js";

/**
 * Phase 10.4 — Atom feed builder. Atom (RFC 4287) over RSS 2.0
 * because Atom has tighter spec compliance, mandatory unique
 * IDs, and timezone-correct timestamps that RSS 2.0 leaves
 * underspecified. Most modern readers consume both, but new
 * surfaces should write Atom.
 *
 * Sites declare which collections expose a feed by giving them
 * `seo.urlPath` (already required for the sitemap, 10.1). The
 * feed reuses the same anonymous-read query path so non-public
 * rows never leak — same trust model as `/sitemap.xml`.
 */

export interface NxFeedEntry {
  /** Stable id (we use the absolute canonical URL). */
  id: string;
  title: string;
  /** Short summary; HTML escaped on the way out. */
  summary: string | null;
  link: string;
  /** Author display name; null when unavailable (e.g. anonymous post). */
  author: string | null;
  /** ISO 8601. The Atom `<updated>` element. */
  updated: string;
  /** ISO 8601. Optional — emitted as `<published>`. */
  published: string | null;
}

export interface BuildAtomFeedOptions {
  collection?: string;
  /** Cap entries per feed. Default 50 — most readers ignore beyond that. */
  limit?: number;
}

const DEFAULT_FEED_LIMIT = 50;
const DEFAULT_FEED_COLLECTION = "posts";

/**
 * Walks a single collection's published documents and returns a
 * flat list of feed entries. Skips collections that don't
 * declare `seo.urlPath` (the same opt-in the sitemap uses).
 * Anonymous read access required — `findDocuments` runs the
 * collection's `access.read` callback with no user.
 */
export async function buildAtomFeed(
  options: BuildAtomFeedOptions = {},
): Promise<{ entries: NxFeedEntry[]; collection: string } | null> {
  const collection = options.collection ?? DEFAULT_FEED_COLLECTION;
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;

  let config;
  try {
    config = getCollectionConfig(collection);
  } catch {
    return null;
  }
  const urlPath = config.seo?.urlPath;
  if (!urlPath) return null;

  const settings = await getSiteSeoSettings();
  const origin = settings.siteUrl.replace(/\/+$/, "");

  let result;
  try {
    result = await findDocuments(
      collection,
      {
        where: { status: "published" },
        limit,
        page: 1,
        sort: "-updatedAt",
      },
      undefined,
    );
  } catch {
    return null;
  }

  const entries: NxFeedEntry[] = [];
  for (const doc of result.docs) {
    const path = urlPath(doc as Record<string, unknown>);
    if (!path) continue;
    const link = `${origin}${path}`;
    const updated = pickIso(
      (doc as { updatedAt?: unknown }).updatedAt ??
        (doc as { createdAt?: unknown }).createdAt,
    );
    if (!updated) continue;
    entries.push({
      id: link,
      title: pickTitle(doc as Record<string, unknown>),
      summary: pickSummary(doc as Record<string, unknown>),
      link,
      author: pickAuthor(doc as Record<string, unknown>),
      updated,
      published: pickIso(
        (doc as { publishedAt?: unknown }).publishedAt ??
          (doc as { createdAt?: unknown }).createdAt,
      ),
    });
  }

  return { entries, collection };
}

function pickTitle(doc: Record<string, unknown>): string {
  if (typeof doc.title === "string" && doc.title.length > 0) return doc.title;
  if (typeof doc.name === "string" && doc.name.length > 0) return doc.name;
  if (typeof doc.slug === "string" && doc.slug.length > 0) return doc.slug;
  return "Untitled";
}

function pickSummary(doc: Record<string, unknown>): string | null {
  for (const key of ["excerpt", "summary", "description", "seoDescription"]) {
    const value = doc[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const trimmed = value.trim();
      return trimmed.length > 500 ? `${trimmed.slice(0, 497)}…` : trimmed;
    }
  }
  return null;
}

function pickAuthor(doc: Record<string, unknown>): string | null {
  // We don't follow relationship FKs here — the lookup would
  // be N+1 and the feed doesn't need a perfect display name.
  // Sites that want author names in their feed should denormalize
  // a `authorName` field onto the row, or add a feed plugin that
  // does the resolution.
  if (typeof doc.authorName === "string" && doc.authorName.length > 0) {
    return doc.authorName;
  }
  return null;
}

function pickIso(value: unknown): string | null {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return null;
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * Renders the Atom 1.0 XML body. Doesn't depend on any specific
 * runtime so it's safe to call from a route handler, a static
 * builder, or a CLI exporter.
 */
export async function renderAtomFeed(
  options: BuildAtomFeedOptions = {},
): Promise<string | null> {
  const result = await buildAtomFeed(options);
  if (!result) return null;
  const settings = await getSiteSeoSettings();
  const origin = settings.siteUrl.replace(/\/+$/, "");
  const collectionPath =
    result.collection === DEFAULT_FEED_COLLECTION
      ? ""
      : `?collection=${encodeURIComponent(result.collection)}`;
  const feedSelfUrl = `${origin}/feed.xml${collectionPath}`;
  const updated = result.entries[0]?.updated ?? new Date().toISOString();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(settings.siteName)}</title>`,
    settings.defaultDescription
      ? `  <subtitle>${escapeXml(settings.defaultDescription)}</subtitle>`
      : "",
    `  <id>${escapeXml(feedSelfUrl)}</id>`,
    `  <link rel="self" href="${escapeXml(feedSelfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(origin)}/"/>`,
    `  <updated>${updated}</updated>`,
  ];
  for (const entry of result.entries) {
    lines.push("  <entry>");
    lines.push(`    <id>${escapeXml(entry.id)}</id>`);
    lines.push(`    <title>${escapeXml(entry.title)}</title>`);
    lines.push(
      `    <link rel="alternate" type="text/html" href="${escapeXml(entry.link)}"/>`,
    );
    lines.push(`    <updated>${entry.updated}</updated>`);
    if (entry.published) {
      lines.push(`    <published>${entry.published}</published>`);
    }
    if (entry.author) {
      lines.push("    <author>");
      lines.push(`      <name>${escapeXml(entry.author)}</name>`);
      lines.push("    </author>");
    }
    if (entry.summary) {
      lines.push(
        `    <summary type="text">${escapeXml(entry.summary)}</summary>`,
      );
    }
    lines.push("  </entry>");
  }
  lines.push("</feed>");
  return lines.filter(Boolean).join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
