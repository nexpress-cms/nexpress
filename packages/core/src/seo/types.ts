export const npSitemapChangeFrequencies = [
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
] as const;

export type NpSitemapChangeFrequency = (typeof npSitemapChangeFrequencies)[number];

export interface NpSitemapAlternate {
  hreflang: string;
  href: string;
}

export interface NpSitemapEntry {
  /** Root-relative URL, optionally including a query string. */
  loc: string;
  /** Canonical ISO 8601 timestamp. */
  lastmod?: string;
  changefreq?: NpSitemapChangeFrequency;
  priority?: number;
  alternates?: readonly NpSitemapAlternate[];
}

export interface NpSitemapIndexEntry {
  /** Root-relative child sitemap URL, optionally including a query string. */
  loc: string;
  /** Canonical ISO 8601 timestamp. */
  lastmod?: string;
}

export interface BuildSitemapOptions {
  perCollectionLimit?: number;
  collections?: readonly string[];
  locale?: string;
}

export interface NpFeedEntry {
  /** Stable absolute HTTP(S) URL. */
  id: string;
  title: string;
  summary: string | null;
  link: string;
  author: string | null;
  /** Canonical ISO 8601 timestamp. */
  updated: string;
  /** Canonical ISO 8601 timestamp. */
  published: string | null;
}

export interface BuildAtomFeedOptions {
  collection?: string;
  limit?: number;
  locale?: string;
  extraEntries?: readonly NpFeedEntry[];
}

export interface NpAtomFeedResult {
  entries: readonly NpFeedEntry[];
  collection: string;
}

export interface NpSiteSeoSettings {
  siteName: string;
  siteUrl: string;
  defaultDescription: string;
  defaultOgImage: string | null;
  twitterHandle: string | null;
  /** Open Graph locale form, for example `en_US`. */
  defaultLocale: string;
}

export interface NpPageMetadataInput {
  title?: string | null;
  description?: string | null;
  ogImage?: string | null;
  path?: string;
  canonicalPath?: string;
  ogType?: "website" | "article" | "profile";
  publishedTime?: Date | null;
  modifiedTime?: Date | null;
  /** Canonical BCP 47 locale for the rendered page. */
  locale?: string;
}

export interface NpPageMetadata {
  title: string;
  description: string;
  alternates?: { canonical: string };
  openGraph?: {
    title: string;
    description: string;
    siteName: string;
    url: string;
    type: "website" | "article" | "profile";
    images?: Array<{ url: string }>;
    locale?: string;
    publishedTime?: string;
    modifiedTime?: string;
  };
  twitter?: {
    card: "summary" | "summary_large_image";
    title: string;
    description: string;
    site?: string;
    images?: string[];
  };
}

export interface BuildJsonLdContext {
  /** Canonical HTTP(S) origin without a trailing slash. */
  origin?: string;
}

export interface WebSiteJsonLd {
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  url: string;
  potentialAction?: {
    "@type": "SearchAction";
    target: { "@type": "EntryPoint"; urlTemplate: string };
    "query-input": string;
  };
}

export interface ArticleJsonLdInput {
  url: string;
  headline: string;
  description?: string | null;
  image?: string | null;
  datePublished?: Date | string | null;
  dateModified?: Date | string | null;
  authorName?: string | null;
  type?: "BlogPosting" | "Article";
}

export interface ArticleJsonLd {
  "@context": "https://schema.org";
  "@type": "BlogPosting" | "Article";
  headline: string;
  url: string;
  description?: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
  author?: { "@type": "Person"; name: string };
  publisher: {
    "@type": "Organization";
    name: string;
    url: string;
  };
}

export interface DiscussionForumPostingJsonLd extends Omit<ArticleJsonLd, "@type"> {
  "@type": "DiscussionForumPosting";
}

export interface PersonJsonLdInput {
  url: string;
  name: string;
  alternateName?: string | null;
  image?: string | null;
  description?: string | null;
}

export interface PersonJsonLd {
  "@context": "https://schema.org";
  "@type": "Person";
  name: string;
  url: string;
  alternateName?: string;
  image?: string;
  description?: string;
}

export type NpSeoContractIssueCode =
  "shape" | "unknown-field" | "invalid-field" | "max-items" | "max-bytes" | "duplicate";

export interface NpSeoContractIssue {
  readonly code: NpSeoContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type NpSeoContractValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issue: NpSeoContractIssue };
