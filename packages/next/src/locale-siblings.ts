import {
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  getI18nConfig,
} from "@nexpress/core";

/**
 * Sprint S — sibling-aware language picker (doc i18n.md §13).
 *
 * Given the request URL path, return the locales that actually
 * publish a translation of the page being rendered. The
 * `LanguagePicker` uses the result to render unavailable locales
 * as disabled `<span>` instead of `<Link>` so visitors can't
 * jump to a guaranteed 404.
 *
 * Resolution rules:
 *
 *   1. Strip the leading locale segment (`/ko/about` → `/about`)
 *      so the slug matches what's stored in i18n collection
 *      tables (the locale lives in its own column).
 *   2. Static / static-list paths (`/`, `/blog`, `/discussions`,
 *      `/search`, `/u/...`, `/members/...`) are served by every
 *      locale via the catch-all → return every configured locale.
 *   3. Walk i18n collections; the first one whose `slug` field
 *      matches the path's last segment wins. Look up its
 *      `translation_group_id` and return the locales of every
 *      published sibling.
 *   4. No match → assume the path is served by a non-i18n
 *      collection where the same row covers every locale URL
 *      (this is what `pages` does today). Return every locale.
 *
 * Returns `null` when i18n is disabled or has fewer than two
 * locales — caller should leave the picker fully enabled.
 */
export async function resolveAvailableLocales(rawPath: string): Promise<string[] | null> {
  const i18n = getI18nConfig();
  if (!i18n || i18n.locales.length < 2) return null;
  const localeSet = new Set(i18n.locales);

  const pathWithoutLocale = stripLocalePrefix(rawPath, localeSet);
  if (isStaticPath(pathWithoutLocale)) {
    return [...i18n.locales];
  }

  const slug = pathWithoutLocale.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) return [...i18n.locales];

  // The path's last segment is what's typically stored in the
  // `slug` column. Multi-segment paths (`/blog/foo`) match
  // `slug = "foo"` after the static prefix is stripped by the
  // catch-all itself; we don't try to be clever about the
  // prefix here — the i18n collections in v1 are flat.
  const candidateSlug = slug.split("/").pop() ?? slug;

  const slugs = getAllCollectionSlugs();
  for (const collectionSlug of slugs) {
    let config;
    try {
      config = getCollectionConfig(collectionSlug);
    } catch {
      continue;
    }
    if (!config.i18n) continue;

    let result;
    try {
      result = await findDocuments(
        collectionSlug,
        {
          where: { slug: candidateSlug, status: "published" },
          limit: 1,
        },
        undefined,
      );
    } catch {
      continue;
    }
    const doc = result.docs[0];
    if (!doc) continue;

    const groupId = typeof doc.translationGroupId === "string" ? doc.translationGroupId : null;
    if (!groupId) {
      // Document exists but isn't part of a translation group —
      // surface only its own locale so the picker doesn't claim
      // siblings that aren't there.
      const locale = typeof doc.locale === "string" ? doc.locale : null;
      return locale ? [locale] : null;
    }

    let siblings;
    try {
      siblings = await findDocuments(
        collectionSlug,
        {
          where: { translationGroupId: groupId, status: "published" },
          limit: 50,
        },
        undefined,
      );
    } catch {
      return null;
    }
    const locales = siblings.docs
      .map((d) => (typeof d.locale === "string" ? d.locale : null))
      .filter((l): l is string => l !== null);
    return locales.length > 0 ? locales : null;
  }

  // No i18n collection claimed this path — assume non-i18n
  // content (`pages`, `posts`, `discussions`) where the same
  // row serves every locale URL via the catch-all.
  return [...i18n.locales];
}

function stripLocalePrefix(rawPath: string, localeSet: Set<string>): string {
  const segments = rawPath.split("/").filter(Boolean);
  const head = segments[0];
  if (head === undefined) return "/";
  if (localeSet.has(head)) {
    return "/" + segments.slice(1).join("/");
  }
  return "/" + segments.join("/");
}

function isStaticPath(pathWithoutLocale: string): boolean {
  if (pathWithoutLocale === "/" || pathWithoutLocale === "") return true;
  // Static list / utility routes that the catch-all serves
  // regardless of locale.
  if (
    pathWithoutLocale === "/blog" ||
    pathWithoutLocale === "/discussions" ||
    pathWithoutLocale === "/search"
  ) {
    return true;
  }
  if (pathWithoutLocale.startsWith("/u/") || pathWithoutLocale.startsWith("/members/")) {
    return true;
  }
  return false;
}
