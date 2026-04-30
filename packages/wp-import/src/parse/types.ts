/**
 * Phase 21.2 — Intermediate Record (IR) types.
 *
 * The IR is the seam between the WXR parser and the importer. The
 * design doc (`docs/design/wordpress-import-design.md` §4) frames why this
 * lives between parse and apply: keeps the parser free of NexPress
 * concerns and lets future adapters (Ghost, Drupal, generic JSON)
 * plug into the same applier.
 *
 * Field names mirror the WXR XML tag names where it doesn't hurt
 * readability (`wpId` for `<wp:post_id>`, `wpType` for
 * `<wp:post_type>`) so reviewers cross-checking against a real
 * export can find the correspondence quickly.
 */

export type WpPostStatus = "publish" | "draft" | "private" | "pending" | "trash" | "auto-draft";

/** A category, post tag, or any custom WP taxonomy term attached to a post. */
export interface WpTerm {
  /** "category", "post_tag", or any custom taxonomy slug. */
  taxonomy: string;
  slug: string;
  name: string;
}

/**
 * A media reference parsed out of a post. Resolved later by the
 * media pipeline (Phase 21.5) into actual nx_media ids.
 */
export interface WpMediaRef {
  /** Source URL on the WP site (e.g. `https://site.com/wp-content/uploads/.../foo.jpg`). */
  sourceUrl: string;
  /** WP attachment id when the reference points at one we know about. */
  wpAttachmentId: number | null;
  /**
   * Where this reference came from in the original document — drives
   * how the applier wires the result. `featured` lands on the post's
   * `coverImage` field; `inline` rewrites the body content.
   */
  kind: "featured" | "inline";
}

export interface WpComment {
  wpId: number;
  /** Parent comment id when the comment is a reply, else null. */
  parentWpId: number | null;
  authorName: string;
  authorEmail: string | null;
  authorUrl: string | null;
  /** ISO timestamp from <wp:comment_date_gmt>. */
  date: string;
  /** Comment body — usually plain text but can contain HTML. */
  content: string;
  /** Maps from <wp:comment_approved> ("1" → true, anything else → false). */
  approved: boolean;
}

/**
 * One post / page / custom post type record in the WXR. The applier
 * walks an array of these to write content into NexPress collections.
 */
export interface WpImportRecord {
  /** Numeric id from <wp:post_id>. Stable across re-exports of the same WP site. */
  wpId: number;
  /** "post" | "page" | custom post type slug. Drives applier collection routing. */
  wpType: string;
  status: WpPostStatus;
  slug: string;
  title: string;
  /** From <excerpt:encoded>. Null when WP didn't write one. */
  excerpt: string | null;
  /**
   * Raw HTML / Gutenberg content from <content:encoded>. Phase 21.4
   * runs this through the HTML→Lexical converter; this PR keeps it
   * as the unmodified string so parser tests stay deterministic.
   */
  rawContent: string;
  /** WP author id from <dc:creator> (resolved against parsed authors). */
  wpAuthorLogin: string;
  /** ISO timestamp from <wp:post_date_gmt>. */
  publishedAt: string;
  /** ISO from <wp:post_modified_gmt>. */
  updatedAt: string;
  terms: WpTerm[];
  /** Resolved <wp:postmeta> entries. Keys preserved verbatim. */
  meta: Record<string, string>;
  mediaRefs: WpMediaRef[];
  comments: WpComment[];
}

export interface WpAuthor {
  wpId: number;
  /** WP login slug — e.g. "alice". */
  login: string;
  email: string;
  displayName: string;
  /** Free-form bio / description from <wp:author_description>. */
  description: string | null;
}

/** Site-level metadata harvested from the <channel> envelope. */
export interface WpSiteInfo {
  /** <title>. */
  title: string;
  /** <link>. */
  link: string;
  /** <description>. */
  description: string;
  /** <wp:base_site_url>. */
  baseSiteUrl: string;
  /** <wp:base_blog_url>. Often the same as baseSiteUrl on single-site WP. */
  baseBlogUrl: string;
  /** <language>, e.g. "en-US". */
  language: string | null;
}

/**
 * The full output of `parseWxr()`. Captures everything an applier
 * needs in one in-memory shape.
 */
export interface WpImportBundle {
  site: WpSiteInfo;
  authors: WpAuthor[];
  /**
   * All records in document order. Includes `attachment` post types
   * (used to resolve media refs) — the applier filters those out
   * after the media pipeline runs.
   */
  records: WpImportRecord[];
  /**
   * Standalone <wp:category> / <wp:tag> / <wp:term> entries from the
   * channel envelope. Most WP exports duplicate these into per-post
   * <category> elements too; the applier de-dupes.
   */
  terms: WpTerm[];
}
