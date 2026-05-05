/**
 * `@nexpress/core/seo` — SEO surface.
 *
 * Sitemap generation, page-metadata composition, JSON-LD builders,
 * and Atom feed rendering. Pure helpers — these never touch the DB
 * directly; callers pass the document records they want serialized.
 */

export { buildSitemap, renderSitemapXml, renderSitemapIndexXml } from "./sitemap.js";
export type { NpSitemapEntry, NpSitemapIndexEntry, BuildSitemapOptions } from "./sitemap.js";
export {
  DEFAULT_SITE_SEO_SETTINGS,
  buildPageMetadata,
  getSiteSeoSettings,
  validateSeoSettingsPatch,
} from "./page-metadata.js";
export type {
  NpSiteSeoSettings,
  NpPageMetadata,
  NpPageMetadataInput,
  NpSeoSettingsPatch,
} from "./page-metadata.js";
export { buildAtomFeed, renderAtomFeed } from "./feed.js";
export type { NpFeedEntry, BuildAtomFeedOptions } from "./feed.js";
export {
  buildArticleJsonLd,
  buildDiscussionForumPostingJsonLd,
  buildPersonJsonLd,
  buildWebSiteJsonLd,
} from "./json-ld.js";
export type {
  ArticleJsonLd,
  ArticleJsonLdInput,
  BuildJsonLdContext,
  DiscussionForumPostingJsonLd,
  PersonJsonLd,
  PersonJsonLdInput,
  WebSiteJsonLd,
} from "./json-ld.js";
