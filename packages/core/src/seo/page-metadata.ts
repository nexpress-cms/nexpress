import { getDb } from "../db/runtime.js";
import { nxSettings } from "../db/schema/system.js";

/**
 * Phase 10.3 — site-wide SEO defaults read from `nx_settings`.
 * Reads three existing keys + a new `seo` key:
 *
 *   - `site`        → { name, url }   (existing General settings)
 *   - `description` → string           (existing General settings)
 *   - `seo`         → { defaultOgImage, twitterHandle, defaultLocale }
 *
 * The shape is a flat merge so callers don't have to hop across
 * keys to pre-fill metadata.
 */
export interface NxSiteSeoSettings {
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

export const DEFAULT_SITE_SEO_SETTINGS: NxSiteSeoSettings = {
  siteName: "NexPress",
  siteUrl: "http://localhost:3000",
  defaultDescription: "",
  defaultOgImage: null,
  twitterHandle: null,
  defaultLocale: "en_US",
};

/**
 * Reads the three settings keys that contribute to site-wide
 * SEO and merges into a single flat object. Missing fields fall
 * back to `DEFAULT_SITE_SEO_SETTINGS`. Read-only access — no
 * permission gate; the values are surfaced in public HTML
 * `<head>` tags.
 */
export async function getSiteSeoSettings(): Promise<NxSiteSeoSettings> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(nxSettings)) as Array<{ key: string; value: unknown }>;

  const map = new Map<string, unknown>();
  for (const row of rows) map.set(row.key, row.value);

  const site = readObject(map.get("site"));
  const seo = readObject(map.get("seo"));
  const description = map.get("description");

  return {
    siteName:
      readString(site?.name) ?? DEFAULT_SITE_SEO_SETTINGS.siteName,
    siteUrl:
      readString(site?.url) ?? DEFAULT_SITE_SEO_SETTINGS.siteUrl,
    defaultDescription:
      (typeof description === "string" ? description : null) ??
      DEFAULT_SITE_SEO_SETTINGS.defaultDescription,
    defaultOgImage:
      readString(seo?.defaultOgImage) ??
      DEFAULT_SITE_SEO_SETTINGS.defaultOgImage,
    twitterHandle:
      readString(seo?.twitterHandle) ??
      DEFAULT_SITE_SEO_SETTINGS.twitterHandle,
    defaultLocale:
      readString(seo?.defaultLocale) ??
      DEFAULT_SITE_SEO_SETTINGS.defaultLocale,
  };
}

function readObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function readString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

/**
 * Caller-provided metadata for a single page. All fields are
 * optional — anything missing falls back to the site-wide
 * defaults from `getSiteSeoSettings()`.
 */
export interface NxPageMetadataInput {
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
   * Path of the current page (no origin). Used to build the
   * canonical URL. Pass without query / hash; trailing `/` is
   * normalized off.
   */
  path?: string;
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
export interface NxPageMetadata {
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
export async function buildPageMetadata(
  input: NxPageMetadataInput = {},
): Promise<NxPageMetadata> {
  const settings = await getSiteSeoSettings();
  const path = normalizePath(input.path);

  const titleText = input.title?.trim()
    ? `${input.title.trim()} · ${settings.siteName}`
    : settings.siteName;
  const descriptionText =
    input.description?.trim() ?? settings.defaultDescription;
  const canonicalUrl = `${settings.siteUrl.replace(/\/+$/, "")}${path}`;
  const ogImage = resolveOgImage(input.ogImage, settings);
  const ogType = input.ogType ?? "website";

  const metadata: NxPageMetadata = {
    title: titleText,
    description: descriptionText,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: titleText,
      description: descriptionText,
      siteName: settings.siteName,
      url: canonicalUrl,
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
  settings: NxSiteSeoSettings,
): string | null {
  const candidate = pageImage?.trim() || settings.defaultOgImage;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith("/")) {
    return `${settings.siteUrl.replace(/\/+$/, "")}${candidate}`;
  }
  return candidate;
}

/**
 * Validates a partial patch against the `seo` settings shape.
 * Throws when fields are mistyped; returns the merged settings
 * the admin endpoint should persist. Mirrors
 * `validateCommunitySettingsPatch` in the community module.
 */
export interface NxSeoSettingsPatch {
  defaultOgImage?: string | null;
  twitterHandle?: string | null;
  defaultLocale?: string | null;
}

export function validateSeoSettingsPatch(
  patch: unknown,
): NxSeoSettingsPatch {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Body must be a JSON object");
  }
  const raw = patch as Record<string, unknown>;
  const out: NxSeoSettingsPatch = {};

  if ("defaultOgImage" in raw) {
    const v = raw.defaultOgImage;
    if (v === null || v === "") {
      out.defaultOgImage = null;
    } else if (typeof v === "string") {
      // Accept absolute URLs or `/`-rooted paths. Reject anything
      // else — a stray `javascript:` URL would be a content-injection
      // hazard since the value lands in `<meta>` tags and `<img>`
      // src on social cards.
      const trimmed = v.trim();
      if (
        !/^https?:\/\//i.test(trimmed) &&
        !trimmed.startsWith("/")
      ) {
        throw new Error(
          "defaultOgImage must be an absolute URL or a /-rooted path",
        );
      }
      out.defaultOgImage = trimmed;
    } else {
      throw new Error("defaultOgImage must be a string or null");
    }
  }

  if ("twitterHandle" in raw) {
    const v = raw.twitterHandle;
    if (v === null || v === "") {
      out.twitterHandle = null;
    } else if (typeof v === "string") {
      // Strip a leading @ — we'll re-add it when emitting tags.
      const trimmed = v.trim().replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) {
        throw new Error(
          "twitterHandle must be 1–15 alphanumeric/underscore characters",
        );
      }
      out.twitterHandle = trimmed;
    } else {
      throw new Error("twitterHandle must be a string or null");
    }
  }

  if ("defaultLocale" in raw) {
    const v = raw.defaultLocale;
    if (v === null || v === "") {
      out.defaultLocale = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      // BCP 47 language tag — loose check (full validation is
      // overkill; ICU does the real work downstream).
      if (!/^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/.test(trimmed)) {
        throw new Error("defaultLocale must look like 'en' or 'en_US'");
      }
      out.defaultLocale = trimmed.replace("-", "_");
    } else {
      throw new Error("defaultLocale must be a string or null");
    }
  }

  return out;
}
