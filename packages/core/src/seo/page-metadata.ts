import { getSeoSettings, getSiteGeneralSettings } from "../settings/service.js";

/**
 * Site-wide SEO defaults resolve site identity from the canonical
 * `np_sites` row and SEO-only values from the validated `seo` setting.
 */
export interface NpSiteSeoSettings {
  /** Site name shown in the title bar suffix and `og:site_name`. */
  siteName: string;
  /** Absolute origin used as the base for canonical URLs. */
  siteUrl: string;
  /** Default `<meta name="description">` when a page doesn't set its own. */
  defaultDescription: string;
  /**
   * Default Open Graph image. Either an absolute URL or a path
   * starting with `/` (which gets joined to `siteUrl`). `null` =
   * no default; pages that don't set an image won't render an
   * `og:image` tag.
   */
  defaultOgImage: string | null;
  /** Twitter `@handle` (no leading `@`) for `twitter:site`. `null` = omit. */
  twitterHandle: string | null;
  /** BCP 47 locale tag for `og:locale`. Default `"en_US"`. */
  defaultLocale: string;
}

export const DEFAULT_SITE_SEO_SETTINGS: NpSiteSeoSettings = {
  siteName: "NexPress",
  siteUrl: "http://localhost:3000",
  defaultDescription: "",
  defaultOgImage: null,
  twitterHandle: null,
  defaultLocale: "en_US",
};

/**
 * Reads the canonical site + SEO contracts and merges them into a
 * single flat object. Missing values fall
 * back to `DEFAULT_SITE_SEO_SETTINGS`. Read-only access — no
 * permission gate; the values are surfaced in public HTML
 * `<head>` tags.
 */
export async function getSiteSeoSettings(): Promise<NpSiteSeoSettings> {
  const [site, seo] = await Promise.all([getSiteGeneralSettings(), getSeoSettings()]);

  return {
    siteName: site.name,
    siteUrl: site.url ?? DEFAULT_SITE_SEO_SETTINGS.siteUrl,
    defaultDescription: site.description ?? DEFAULT_SITE_SEO_SETTINGS.defaultDescription,
    defaultOgImage: seo.defaultOgImage,
    twitterHandle: seo.twitterHandle,
    defaultLocale: seo.defaultLocale,
  };
}

/**
 * Caller-provided metadata for a single page. All fields are
 * optional — anything missing falls back to the site-wide
 * defaults from `getSiteSeoSettings()`.
 */
export interface NpPageMetadataInput {
  /** Page title (without site-name suffix; that's appended below). */
  title?: string | null;
  /** Page-specific description. Falls back to site default. */
  description?: string | null;
  /**
   * Image URL for og:image / twitter:image. Either absolute or
   * a path starting with `/` (joined to siteUrl). Falls back to
   * `defaultOgImage`.
   */
  ogImage?: string | null;
  /**
   * Path of the current page (no origin). Drives the OpenGraph
   * `url` field (which represents "this resource"). Also serves
   * as the default for `canonicalPath` when that's not set.
   * Pass without trailing `/` — trailing slashes are normalized
   * off — but query strings are preserved so paginated /
   * filtered routes can identify themselves accurately.
   */
  path?: string;
  /**
   * Override the canonical URL path when the page represents
   * one resource but search engines should treat a different
   * URL as authoritative. Defaults to `path`. Use when /blog
   * canonicalises to / on a theme that renders the same content
   * at both, or when a paginated route should dedupe to its
   * first page. Leaving this unset means "canonical = self",
   * which is correct for most pages.
   */
  canonicalPath?: string;
  /** OpenGraph type. Default `"website"`; posts use `"article"`. */
  ogType?: "website" | "article" | "profile";
  /**
   * Article-specific dates (only honored when `ogType === "article"`).
   * Pass `Date` instances — the helper formats to ISO 8601.
   */
  publishedTime?: Date | null;
  modifiedTime?: Date | null;
  /**
   * Phase 12.2 — locale for the rendered page. Surfaces into
   * `og:locale` so social cards label the language correctly.
   * Optional; sites without i18n leave it unset and the helper
   * omits `og:locale` from the output.
   */
  locale?: string;
}

/**
 * Next.js Metadata shape — kept structurally typed here to avoid
 * a hard dependency on the framework from core. The reference app
 * casts the return to Next's `Metadata` (the field names match).
 */
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

/**
 * Combines the page-level input with site-wide SEO defaults to
 * produce a fully-resolved metadata object suitable for
 * Next.js' `generateMetadata`. Title, description, and image
 * fall back through to defaults; the OG and Twitter blocks are
 * mirrored so both crawler families see consistent values.
 */
export async function buildPageMetadata(input: NpPageMetadataInput = {}): Promise<NpPageMetadata> {
  const settings = await getSiteSeoSettings();
  const path = normalizePath(input.path);
  const canonicalPath = normalizePath(input.canonicalPath ?? input.path);

  const titleText = input.title?.trim()
    ? `${input.title.trim()} · ${settings.siteName}`
    : settings.siteName;
  const descriptionText = input.description?.trim() ?? settings.defaultDescription;
  const siteOrigin = settings.siteUrl.replace(/\/+$/, "");
  const canonicalUrl = `${siteOrigin}${canonicalPath}`;
  const ogUrl = `${siteOrigin}${path}`;
  const ogImage = resolveOgImage(input.ogImage, settings);
  const ogType = input.ogType ?? "website";

  const metadata: NpPageMetadata = {
    title: titleText,
    description: descriptionText,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: titleText,
      description: descriptionText,
      siteName: settings.siteName,
      url: ogUrl,
      type: ogType,
      // Page-supplied locale wins over the site default so
      // translated copies surface their actual language to
      // social previews. Falls back to the site setting when
      // the caller doesn't pass one (non-i18n routes).
      locale: input.locale ?? settings.defaultLocale,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
      ...(ogType === "article" && input.publishedTime
        ? { publishedTime: input.publishedTime.toISOString() }
        : {}),
      ...(ogType === "article" && input.modifiedTime
        ? { modifiedTime: input.modifiedTime.toISOString() }
        : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: titleText,
      description: descriptionText,
      ...(settings.twitterHandle ? { site: `@${settings.twitterHandle}` } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };

  return metadata;
}

function normalizePath(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw === "/") return "/";
  return raw.replace(/\/+$/, "");
}

function resolveOgImage(
  pageImage: string | null | undefined,
  settings: NpSiteSeoSettings,
): string | null {
  const candidate = pageImage?.trim() || settings.defaultOgImage;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("/")) {
    return `${settings.siteUrl.replace(/\/+$/, "")}${candidate}`;
  }
  return candidate;
}
