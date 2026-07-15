import {
  npRequireArticleJsonLdInput,
  npRequireJsonLdContext,
  npRequirePersonJsonLdInput,
} from "./contract.js";
import { getSiteSeoSettings } from "./page-metadata.js";
import type {
  ArticleJsonLd,
  ArticleJsonLdInput,
  BuildJsonLdContext,
  DiscussionForumPostingJsonLd,
  PersonJsonLd,
  PersonJsonLdInput,
  WebSiteJsonLd,
} from "./types.js";

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

const SCHEMA = "https://schema.org" as const;

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
export async function buildWebSiteJsonLd(ctx: BuildJsonLdContext = {}): Promise<WebSiteJsonLd> {
  const parsedContext = npRequireJsonLdContext(ctx);
  const settings = await getSiteSeoSettings();
  const origin = parsedContext.origin ?? settings.siteUrl;
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
export async function buildArticleJsonLd(
  input: ArticleJsonLdInput,
  ctx: BuildJsonLdContext = {},
): Promise<ArticleJsonLd> {
  const parsedInput = npRequireArticleJsonLdInput(input);
  const parsedContext = npRequireJsonLdContext(ctx);
  const settings = await getSiteSeoSettings();
  const origin = parsedContext.origin ?? settings.siteUrl;

  const out: ArticleJsonLd = {
    "@context": SCHEMA,
    "@type": parsedInput.type ?? "BlogPosting",
    headline: parsedInput.headline,
    url: parsedInput.url,
    publisher: {
      "@type": "Organization",
      name: settings.siteName,
      url: `${origin}/`,
    },
  };
  if (parsedInput.description) out.description = parsedInput.description;
  if (parsedInput.image) out.image = absoluteUrl(origin, parsedInput.image);
  const published = toIso(parsedInput.datePublished);
  if (published) out.datePublished = published;
  const modified = toIso(parsedInput.dateModified);
  if (modified) out.dateModified = modified;
  if (parsedInput.authorName) {
    out.author = { "@type": "Person", name: parsedInput.authorName };
  }
  return out;
}

/**
 * `DiscussionForumPosting` for member-authored forum threads.
 * Same skeleton as `Article` but the type tells search engines
 * (and surfaces like Google's "Forums" filter) that this is
 * community discussion, not editorial content.
 */
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
export async function buildPersonJsonLd(
  input: PersonJsonLdInput,
  ctx: BuildJsonLdContext = {},
): Promise<PersonJsonLd> {
  const parsedInput = npRequirePersonJsonLdInput(input);
  const parsedContext = npRequireJsonLdContext(ctx);
  const origin = parsedContext.origin ?? (await getSiteSeoSettings()).siteUrl;
  const out: PersonJsonLd = {
    "@context": SCHEMA,
    "@type": "Person",
    name: parsedInput.name,
    url: parsedInput.url,
  };
  if (parsedInput.alternateName) out.alternateName = parsedInput.alternateName;
  if (parsedInput.image) out.image = absoluteUrl(origin, parsedInput.image);
  if (parsedInput.description) out.description = parsedInput.description;
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
