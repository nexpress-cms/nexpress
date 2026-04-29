import { XMLParser } from "fast-xml-parser";

import {
  type WpAuthor,
  type WpComment,
  type WpImportBundle,
  type WpImportRecord,
  type WpMediaRef,
  type WpPostStatus,
  type WpSiteInfo,
  type WpTerm,
} from "./types.js";

/**
 * Phase 21.2 — WXR parser. Reads a WordPress eXtended RSS export
 * (the file produced by Tools → Export in wp-admin) and produces
 * an in-memory bundle of typed Intermediate Records.
 *
 * The parser is deliberately tolerant:
 *
 *   - Missing namespace-prefixed tags (`wp:`, `dc:`, `content:`,
 *     `excerpt:`) fall back to sensible defaults rather than
 *     throwing, because real-world WXR files vary in how strictly
 *     they're written by WP plugins.
 *   - <category> elements appear in two shapes (channel-level
 *     <wp:category> and per-post <category>); we handle both.
 *   - The CDATA wrapping around <content:encoded> is unwrapped
 *     transparently by `fast-xml-parser`.
 *
 * NOT in this PR: streaming parse for huge exports (Phase 21.10),
 * media downloading (21.5), HTML-to-Lexical conversion (21.4).
 */
export function parseWxr(xml: string): WpImportBundle {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    cdataPropName: "__cdata",
    isArray: (name) => MULTI_VALUE_TAGS.has(name),
  });

  const tree = parser.parse(xml) as { rss?: { channel?: WxrChannel } };
  const channel = tree.rss?.channel;
  if (!channel) {
    throw new Error("Invalid WXR: missing <rss><channel> root");
  }

  const site = parseSite(channel);
  const authors = parseAuthors(channel);
  const terms = parseChannelTerms(channel);
  const records = parseRecords(channel);

  return { site, authors, terms, records };
}

/**
 * Tags that may appear multiple times under the same parent. The
 * `fast-xml-parser` default is to collapse duplicates into a
 * single value; flagging these forces the array shape we need.
 */
const MULTI_VALUE_TAGS = new Set([
  "item",
  "wp:author",
  "wp:category",
  "wp:tag",
  "wp:term",
  "wp:postmeta",
  "wp:comment",
  "category",
]);

interface WxrText {
  __cdata?: string;
  "#text"?: string;
}

type WxrValue = string | WxrText | undefined;

function asText(value: WxrValue): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.__cdata === "string") return value.__cdata;
  if (typeof value["#text"] === "string") return value["#text"];
  return "";
}

function asOptionalText(value: WxrValue): string | null {
  const text = asText(value);
  return text.length > 0 ? text : null;
}

interface WxrChannel {
  title?: WxrValue;
  link?: WxrValue;
  description?: WxrValue;
  language?: WxrValue;
  "wp:base_site_url"?: WxrValue;
  "wp:base_blog_url"?: WxrValue;
  "wp:author"?: WxrAuthor[];
  "wp:category"?: WxrTaxonomy[];
  "wp:tag"?: WxrTaxonomy[];
  "wp:term"?: WxrTaxonomy[];
  item?: WxrItem[];
}

function parseSite(channel: WxrChannel): WpSiteInfo {
  return {
    title: asText(channel.title),
    link: asText(channel.link),
    description: asText(channel.description),
    baseSiteUrl: asText(channel["wp:base_site_url"]),
    baseBlogUrl: asText(channel["wp:base_blog_url"]),
    language: asOptionalText(channel.language),
  };
}

interface WxrAuthor {
  "wp:author_id"?: WxrValue;
  "wp:author_login"?: WxrValue;
  "wp:author_email"?: WxrValue;
  "wp:author_display_name"?: WxrValue;
  "wp:author_first_name"?: WxrValue;
  "wp:author_last_name"?: WxrValue;
  "wp:author_description"?: WxrValue;
}

function parseAuthors(channel: WxrChannel): WpAuthor[] {
  const rows = channel["wp:author"] ?? [];
  return rows.map((row) => ({
    wpId: parseIntOrZero(asText(row["wp:author_id"])),
    login: asText(row["wp:author_login"]),
    email: asText(row["wp:author_email"]),
    displayName: asText(row["wp:author_display_name"]),
    description: asOptionalText(row["wp:author_description"]),
  }));
}

interface WxrTaxonomy {
  "wp:term_id"?: WxrValue;
  "wp:term_taxonomy"?: WxrValue;
  "wp:taxonomy"?: WxrValue;
  "wp:category_nicename"?: WxrValue;
  "wp:tag_slug"?: WxrValue;
  "wp:term_slug"?: WxrValue;
  "wp:cat_name"?: WxrValue;
  "wp:tag_name"?: WxrValue;
  "wp:term_name"?: WxrValue;
}

function parseChannelTerms(channel: WxrChannel): WpTerm[] {
  const out: WpTerm[] = [];
  for (const row of channel["wp:category"] ?? []) {
    out.push({
      taxonomy: "category",
      slug: asText(row["wp:category_nicename"]),
      name: asText(row["wp:cat_name"]),
    });
  }
  for (const row of channel["wp:tag"] ?? []) {
    out.push({
      taxonomy: "post_tag",
      slug: asText(row["wp:tag_slug"]),
      name: asText(row["wp:tag_name"]),
    });
  }
  for (const row of channel["wp:term"] ?? []) {
    const taxonomy = asText(row["wp:term_taxonomy"]) || asText(row["wp:taxonomy"]);
    if (!taxonomy) continue;
    out.push({
      taxonomy,
      slug: asText(row["wp:term_slug"]),
      name: asText(row["wp:term_name"]),
    });
  }
  return out;
}

interface WxrItem {
  title?: WxrValue;
  link?: WxrValue;
  pubDate?: WxrValue;
  "dc:creator"?: WxrValue;
  guid?: WxrValue | { "#text"?: string; "@_isPermaLink"?: string };
  description?: WxrValue;
  "content:encoded"?: WxrValue;
  "excerpt:encoded"?: WxrValue;
  "wp:post_id"?: WxrValue;
  "wp:post_date"?: WxrValue;
  "wp:post_date_gmt"?: WxrValue;
  "wp:post_modified"?: WxrValue;
  "wp:post_modified_gmt"?: WxrValue;
  "wp:comment_status"?: WxrValue;
  "wp:ping_status"?: WxrValue;
  "wp:post_name"?: WxrValue;
  "wp:status"?: WxrValue;
  "wp:post_parent"?: WxrValue;
  "wp:menu_order"?: WxrValue;
  "wp:post_type"?: WxrValue;
  "wp:post_password"?: WxrValue;
  "wp:is_sticky"?: WxrValue;
  "wp:attachment_url"?: WxrValue;
  category?: WxrItemCategory[];
  "wp:postmeta"?: WxrPostMeta[];
  "wp:comment"?: WxrCommentRow[];
}

interface WxrItemCategory {
  "@_domain"?: string;
  "@_nicename"?: string;
  "#text"?: string;
  /** CDATA-wrapped text content (`<![CDATA[News]]>`) lives here. */
  __cdata?: string;
}

interface WxrPostMeta {
  "wp:meta_key"?: WxrValue;
  "wp:meta_value"?: WxrValue;
}

interface WxrCommentRow {
  "wp:comment_id"?: WxrValue;
  "wp:comment_parent"?: WxrValue;
  "wp:comment_author"?: WxrValue;
  "wp:comment_author_email"?: WxrValue;
  "wp:comment_author_url"?: WxrValue;
  "wp:comment_date_gmt"?: WxrValue;
  "wp:comment_content"?: WxrValue;
  "wp:comment_approved"?: WxrValue;
}

function parseRecords(channel: WxrChannel): WpImportRecord[] {
  const items = channel.item ?? [];
  return items.map((item) => parseRecord(item));
}

function parseRecord(item: WxrItem): WpImportRecord {
  const meta = parseMeta(item);
  const status = coerceStatus(asText(item["wp:status"]));
  const wpType = asText(item["wp:post_type"]);
  const rawContent = asText(item["content:encoded"]);
  const attachmentUrl = asText(item["wp:attachment_url"]);

  return {
    wpId: parseIntOrZero(asText(item["wp:post_id"])),
    wpType,
    status,
    slug: asText(item["wp:post_name"]),
    title: asText(item.title),
    excerpt: asOptionalText(item["excerpt:encoded"]),
    rawContent,
    wpAuthorLogin: asText(item["dc:creator"]),
    publishedAt: asText(item["wp:post_date_gmt"]),
    updatedAt: asText(item["wp:post_modified_gmt"]),
    terms: parseItemCategories(item),
    meta,
    mediaRefs: parseMediaRefs({ rawContent, attachmentUrl, wpType, meta }),
    comments: parseComments(item),
  };
}

function parseItemCategories(item: WxrItem): WpTerm[] {
  const out: WpTerm[] = [];
  for (const row of item.category ?? []) {
    const taxonomy = row["@_domain"] ?? "category";
    out.push({
      taxonomy,
      slug: row["@_nicename"] ?? "",
      // Real WXR exports wrap the term name in CDATA, but tests
      // and hand-written XML may use plain text. Read both.
      name: row.__cdata ?? row["#text"] ?? "",
    });
  }
  return out;
}

function parseMeta(item: WxrItem): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of item["wp:postmeta"] ?? []) {
    const key = asText(row["wp:meta_key"]);
    if (!key) continue;
    out[key] = asText(row["wp:meta_value"]);
  }
  return out;
}

function parseComments(item: WxrItem): WpComment[] {
  const rows = item["wp:comment"] ?? [];
  return rows.map((row) => ({
    wpId: parseIntOrZero(asText(row["wp:comment_id"])),
    parentWpId: parseOptionalInt(asText(row["wp:comment_parent"])),
    authorName: asText(row["wp:comment_author"]),
    authorEmail: asOptionalText(row["wp:comment_author_email"]),
    authorUrl: asOptionalText(row["wp:comment_author_url"]),
    date: asText(row["wp:comment_date_gmt"]),
    content: asText(row["wp:comment_content"]),
    approved: asText(row["wp:comment_approved"]) === "1",
  }));
}

/**
 * Pull every <img src="…">, <a href="…">, and the post's
 * featured-image post-meta into a single MediaRef list. Phase 21.5
 * resolves these against the WP attachment records.
 *
 * The src extraction is regex-based on the rawContent string.
 * A proper HTML walk lands in 21.4 alongside the Lexical converter;
 * regex is enough to identify which URLs the importer needs to
 * pull down.
 */
/**
 * Match an entire `<img>` tag so we can pull both `src` and the
 * optional `wp-image-N` class. The earlier version of this regex
 * only captured up to and including `src`, which dropped the class
 * when it appeared after src in the source HTML — causing the
 * attachment id to look unknown for inline images.
 */
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const WP_ATTACHMENT_ID_RE = /wp-image-(\d+)/i;

function parseMediaRefs(args: {
  rawContent: string;
  attachmentUrl: string;
  wpType: string;
  meta: Record<string, string>;
}): WpMediaRef[] {
  const refs: WpMediaRef[] = [];

  // Featured image — WP records the attachment id (not the URL)
  // in `_thumbnail_id` post-meta. The applier looks the id up in
  // the bundle's attachment records to get the source URL.
  const thumbId = args.meta._thumbnail_id;
  if (thumbId) {
    refs.push({
      sourceUrl: "",
      wpAttachmentId: parseIntOrZero(thumbId),
      kind: "featured",
    });
  }

  // Inline <img> references. Capture src + the attachment id from
  // the wp-image-N class (anywhere in the tag — class can come
  // before or after src).
  const seen = new Set<string>();
  for (const tagMatch of args.rawContent.matchAll(IMG_TAG_RE)) {
    const tag = tagMatch[0];
    const srcMatch = SRC_ATTR_RE.exec(tag);
    const url = srcMatch?.[1];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const idMatch = WP_ATTACHMENT_ID_RE.exec(tag);
    refs.push({
      sourceUrl: url,
      wpAttachmentId: idMatch ? parseIntOrZero(idMatch[1] ?? "") : null,
      kind: "inline",
    });
  }

  // Attachment records carry their URL in <wp:attachment_url>
  // directly. Surface that too so 21.5 can index attachments by id.
  if (args.wpType === "attachment" && args.attachmentUrl) {
    refs.push({
      sourceUrl: args.attachmentUrl,
      wpAttachmentId: null,
      kind: "inline",
    });
  }

  return refs;
}

function coerceStatus(raw: string): WpPostStatus {
  switch (raw) {
    case "publish":
    case "draft":
    case "private":
    case "pending":
    case "trash":
    case "auto-draft":
      return raw;
    default:
      // WP also uses "inherit" for revisions / attachments. The
      // applier filters those out by `wpType`, so coercing to
      // "draft" is harmless and keeps the type union narrow.
      return "draft";
  }
}

function parseIntOrZero(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseOptionalInt(value: string): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
