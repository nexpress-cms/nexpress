import { getSeoSettings, getSiteGeneralSettings } from "../settings/service.js";
import { npRequirePageMetadataInput, npRequireSiteSeoSettings } from "./contract.js";
import type { NpPageMetadata, NpPageMetadataInput, NpSiteSeoSettings } from "./types.js";

export const DEFAULT_SITE_SEO_SETTINGS: NpSiteSeoSettings = Object.freeze({
  siteName: "Default site",
  siteUrl: "http://localhost:3000",
  defaultDescription: "",
  defaultOgImage: null,
  twitterHandle: null,
  defaultLocale: "en_US",
});

/**
 * Reads the canonical site + SEO contracts and merges them into a
 * single flat object. Missing values fall
 * back to `DEFAULT_SITE_SEO_SETTINGS`. Read-only access — no
 * permission gate; the values are surfaced in public HTML
 * `<head>` tags.
 */
export async function getSiteSeoSettings(): Promise<NpSiteSeoSettings> {
  const [site, seo] = await Promise.all([getSiteGeneralSettings(), getSeoSettings()]);

  return npRequireSiteSeoSettings({
    siteName: site.name,
    siteUrl: site.url ?? DEFAULT_SITE_SEO_SETTINGS.siteUrl,
    defaultDescription: site.description ?? DEFAULT_SITE_SEO_SETTINGS.defaultDescription,
    defaultOgImage: seo.defaultOgImage,
    twitterHandle: seo.twitterHandle,
    defaultLocale: seo.defaultLocale,
  });
}

/**
 * Combines the page-level input with site-wide SEO defaults to
 * produce a fully-resolved metadata object suitable for
 * Next.js' `generateMetadata`. Title, description, and image
 * fall back through to defaults; the OG and Twitter blocks are
 * mirrored so both crawler families see consistent values.
 */
export async function buildPageMetadata(input: NpPageMetadataInput = {}): Promise<NpPageMetadata> {
  const parsedInput = npRequirePageMetadataInput(input);
  const settings = await getSiteSeoSettings();
  const path = normalizePath(parsedInput.path);
  const canonicalPath = normalizePath(parsedInput.canonicalPath ?? parsedInput.path);

  const titleText = parsedInput.title?.trim()
    ? `${parsedInput.title.trim()} · ${settings.siteName}`
    : settings.siteName;
  const descriptionText = parsedInput.description?.trim() ?? settings.defaultDescription;
  const siteOrigin = settings.siteUrl;
  const canonicalUrl = `${siteOrigin}${canonicalPath}`;
  const ogUrl = `${siteOrigin}${path}`;
  const ogImage = resolveOgImage(parsedInput.ogImage, settings);
  const ogType = parsedInput.ogType ?? "website";

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
      locale: parsedInput.locale ?? settings.defaultLocale,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
      ...(ogType === "article" && parsedInput.publishedTime
        ? { publishedTime: parsedInput.publishedTime.toISOString() }
        : {}),
      ...(ogType === "article" && parsedInput.modifiedTime
        ? { modifiedTime: parsedInput.modifiedTime.toISOString() }
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
  if (!raw) return "/";
  if (raw === "/") return "/";
  const queryIndex = raw.indexOf("?");
  const pathname = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : raw.slice(queryIndex);
  return `${pathname.replace(/\/+$/, "") || "/"}${query}`;
}

function resolveOgImage(
  pageImage: string | null | undefined,
  settings: NpSiteSeoSettings,
): string | null {
  const candidate = pageImage?.trim() || settings.defaultOgImage;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("/")) {
    return `${settings.siteUrl}${candidate}`;
  }
  return candidate;
}
