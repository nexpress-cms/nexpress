/**
 * `@nexpress/core/seo` — SEO surface.
 *
 * Sitemap generation, page-metadata composition, JSON-LD builders,
 * and Atom feed rendering. Pure helpers — these never touch the DB
 * directly; callers pass the document records they want serialized.
 */

export { buildSitemap, renderSitemapXml, renderSitemapIndexXml } from "./sitemap.js";
export {
  DEFAULT_SITE_SEO_SETTINGS,
  buildPageMetadata,
  getSiteSeoSettings,
} from "./page-metadata.js";
export { buildAtomFeed, renderAtomFeed } from "./feed.js";
export {
  buildArticleJsonLd,
  buildDiscussionForumPostingJsonLd,
  buildPersonJsonLd,
  buildWebSiteJsonLd,
} from "./json-ld.js";
export {
  NpSeoContractError,
  npAnalyzeArticleJsonLdInput,
  npAnalyzeFeedEntries,
  npAnalyzePageMetadataInput,
  npAnalyzePersonJsonLdInput,
  npAnalyzeSitemapEntries,
  npAnalyzeSitemapIndexEntries,
  npDefineFeedEntries,
  npDefineSitemapEntries,
  npRequireArticleJsonLdInput,
  npRequireAtomFeedOptions,
  npRequireFeedEntries,
  npRequireJsonLdContext,
  npRequirePageMetadataInput,
  npRequirePersonJsonLdInput,
  npRequireRobotsTxt,
  npRequireSeoOrigin,
  npRequireSeoPath,
  npRequireSiteSeoSettings,
  npRequireSitemapEntries,
  npRequireSitemapIndexEntries,
  npRequireSitemapOptions,
  npSeoContractLimits,
  npValidateFeedEntries,
  npValidateSitemapEntries,
} from "./contract.js";
export { npSitemapChangeFrequencies } from "./types.js";
export type {
  ArticleJsonLd,
  ArticleJsonLdInput,
  BuildAtomFeedOptions,
  BuildJsonLdContext,
  BuildSitemapOptions,
  DiscussionForumPostingJsonLd,
  NpAtomFeedResult,
  NpFeedEntry,
  NpPageMetadata,
  NpPageMetadataInput,
  PersonJsonLd,
  PersonJsonLdInput,
  NpSeoContractIssue,
  NpSeoContractIssueCode,
  NpSeoContractValidationResult,
  NpSiteSeoSettings,
  NpSitemapAlternate,
  NpSitemapChangeFrequency,
  NpSitemapEntry,
  NpSitemapIndexEntry,
  WebSiteJsonLd,
} from "./types.js";
