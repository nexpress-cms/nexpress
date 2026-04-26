import { getSiteSeoSettings } from "./page-metadata.js";

/**
 * Phase 10.5 — JSON-LD structured data builders. Schema.org
 * vocabulary, embedded into pages as
 * `<script type="application/ld+json">{ ... }</script>`. The
 * builders here produce plain objects; pages render them via
 * the helper component the reference app declares
 * (`@/components/json-ld`). Keeping the builders structural
 * (no React dependency) lets non-Next consumers — static
 * exporters, mobile bridges, plugin tests — emit the same
 * shapes.
 *
 * Why JSON-LD over Microdata / RDFa: Google explicitly
 * recommends JSON-LD as the preferred format for structured
 * data, and it composes cleanly because it doesn't require
 * splicing schema attributes into the page markup.
 */

const SCHEMA = "https://schema.org";

export interface BuildJsonLdContext {
  /** Origin without trailing slash. Falls back to settings if omitted. */
  origin?: string;
}

async function resolveOrigin(ctx: BuildJsonLdContext = {}): Promise<string> {
  if (ctx.origin) return ctx.origin.replace(/\/+$/, "");
  const settings = await getSiteSeoSettings();
  return settings.siteUrl.replace(/\/+$/, "");
}

function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * `WebSite` + `SearchAction` for the site root. Tells search
 * engines the canonical site name and lets Google render a
 * sitelinks searchbox in result pages — when the user types
 * into it, the engine routes them straight to /search?q=… on
 * the site instead of returning more SERP results.
 */
export interface WebSiteJsonLd {
  "@context": typeof SCHEMA;
  "@type": "WebSite";
  name: string;
  url: string;
  potentialAction?: {
    "@type": "SearchAction";
    target: { "@type": "EntryPoint"; urlTemplate: string };
    "query-input": string;
  };
}

export async function buildWebSiteJsonLd(
  ctx: BuildJsonLdContext = {},
): Promise<WebSiteJsonLd> {
  const settings = await getSiteSeoSettings();
  const origin = await resolveOrigin(ctx);
  return {
    "@context": SCHEMA,
    "@type": "WebSite",
    name: settings.siteName,
    url: `${origin}/`,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * `BlogPosting` (a subtype of Article) for blog posts. Keeps
 * the structural fields a search engine cares about — headline,
 * dates, author, image, description — without trying to encode
 * the body content.
 */
export interface ArticleJsonLdInput {
  /** Canonical URL of the article. */
  url: string;
  headline: string;
  description?: string | null;
  /** Absolute URL or `/`-rooted path. Resolved against `origin`. */
  image?: string | null;
  datePublished?: Date | string | null;
  dateModified?: Date | string | null;
  authorName?: string | null;
  /** Schema.org type. Defaults to `BlogPosting`; forum threads use
   *  `DiscussionForumPosting` via `buildDiscussionForumPostingJsonLd`. */
  type?: "BlogPosting" | "Article";
}

export interface ArticleJsonLd {
  "@context": typeof SCHEMA;
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

export async function buildArticleJsonLd(
  input: ArticleJsonLdInput,
  ctx: BuildJsonLdContext = {},
): Promise<ArticleJsonLd> {
  const settings = await getSiteSeoSettings();
  const origin = await resolveOrigin(ctx);

  const out: ArticleJsonLd = {
    "@context": SCHEMA,
    "@type": input.type ?? "BlogPosting",
    headline: input.headline,
    url: input.url,
    publisher: {
      "@type": "Organization",
      name: settings.siteName,
      url: `${origin}/`,
    },
  };
  if (input.description) out.description = input.description;
  if (input.image) out.image = absoluteUrl(origin, input.image);
  const published = toIso(input.datePublished);
  if (published) out.datePublished = published;
  const modified = toIso(input.dateModified);
  if (modified) out.dateModified = modified;
  if (input.authorName) {
    out.author = { "@type": "Person", name: input.authorName };
  }
  return out;
}

/**
 * `DiscussionForumPosting` for member-authored forum threads.
 * Same skeleton as `Article` but the type tells search engines
 * (and surfaces like Google's "Forums" filter) that this is
 * community discussion, not editorial content.
 */
export interface DiscussionForumPostingJsonLd
  extends Omit<ArticleJsonLd, "@type"> {
  "@type": "DiscussionForumPosting";
}

export async function buildDiscussionForumPostingJsonLd(
  input: ArticleJsonLdInput,
  ctx: BuildJsonLdContext = {},
): Promise<DiscussionForumPostingJsonLd> {
  const article = await buildArticleJsonLd(input, ctx);
  return { ...article, "@type": "DiscussionForumPosting" };
}

/**
 * `Person` for member / user profile pages. Keeps the public
 * fields a search engine could legitimately surface — handle,
 * display name, profile URL, avatar.
 */
export interface PersonJsonLdInput {
  url: string;
  name: string;
  alternateName?: string | null;
  image?: string | null;
  description?: string | null;
}

export interface PersonJsonLd {
  "@context": typeof SCHEMA;
  "@type": "Person";
  name: string;
  url: string;
  alternateName?: string;
  image?: string;
  description?: string;
}

export async function buildPersonJsonLd(
  input: PersonJsonLdInput,
  ctx: BuildJsonLdContext = {},
): Promise<PersonJsonLd> {
  const origin = await resolveOrigin(ctx);
  const out: PersonJsonLd = {
    "@context": SCHEMA,
    "@type": "Person",
    name: input.name,
    url: input.url,
  };
  if (input.alternateName) out.alternateName = input.alternateName;
  if (input.image) out.image = absoluteUrl(origin, input.image);
  if (input.description) out.description = input.description;
  return out;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}
