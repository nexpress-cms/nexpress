import { getI18nConfig } from "./registry.js";

export interface NpResolveLocaleInput {
  /**
   * Request pathname (e.g. `/en/blog/post-1` or `/blog/post-1`).
   * The first segment is checked against the configured locale
   * list — if it matches, that locale wins. This is the
   * primary signal: themes / page authors building under
   * `app/(site)/*` always have a pathname.
   */
  pathname?: string;
  /**
   * `Accept-Language` header value. Used as a fallback when the
   * pathname doesn't carry a locale prefix. The first
   * comma-separated tag whose primary subtag matches a configured
   * locale wins. Quality factors are honored.
   */
  acceptLanguage?: string;
}

export interface NpResolveLocaleResult {
  /**
   * The resolved locale code (e.g. `"en"`, `"ko"`). Always one
   * of the configured locales; never an arbitrary user-supplied
   * string.
   */
  locale: string;
  /**
   * Where the locale came from. Useful when the page wants to
   * decide whether to issue a 301 (redirect bare `/blog` to
   * `/{defaultLocale}/blog` for SEO) or render in place.
   */
  source: "path" | "header" | "default";
  /**
   * The pathname with the locale prefix stripped, when the
   * locale came from the path. Same as the input pathname
   * otherwise. Useful for downstream slug lookups that store
   * paths without the locale segment.
   */
  pathnameWithoutLocale: string | undefined;
}

/**
 * Resolve the current request's locale using the same conventions
 * the reference app's `[[...slug]]` route uses, so theme / page
 * authors don't have to reimplement the logic.
 *
 *  1. Pathname prefix (`/en/...`) — wins if present and matches
 *     a configured locale.
 *  2. `Accept-Language` header — first tag whose primary subtag
 *     (or full tag) matches a configured locale.
 *  3. The site's default locale.
 *
 * Returns `null` only when i18n hasn't been configured for the
 * site (no `nexpressConfig.i18n` set). Page authors should treat
 * that as "monolingual site" and ignore locale entirely.
 */
export function resolveLocale(input: NpResolveLocaleInput = {}): NpResolveLocaleResult | null {
  const config = getI18nConfig();
  if (!config) return null;
  const configured = new Set(config.locales);

  if (input.pathname) {
    const segments = input.pathname.split("/").filter(Boolean);
    const first = segments[0];
    if (first && configured.has(first)) {
      const remaining = segments.slice(1).join("/");
      const without = remaining.length > 0 ? `/${remaining}` : "/";
      return { locale: first, source: "path", pathnameWithoutLocale: without };
    }
  }

  const fromHeader = matchAcceptLanguage(input.acceptLanguage, configured);
  if (fromHeader) {
    return { locale: fromHeader, source: "header", pathnameWithoutLocale: input.pathname };
  }

  return {
    locale: config.defaultLocale,
    source: "default",
    pathnameWithoutLocale: input.pathname,
  };
}

/**
 * Convenience wrapper that returns just the locale string.
 * Returns the default locale when i18n isn't configured (instead
 * of null) so call sites can blindly chain `.toLowerCase()` etc.
 * without a null check. Use `resolveLocale` directly when you
 * need the source / stripped path.
 */
export function getCurrentLocale(input: NpResolveLocaleInput = {}): string {
  const resolved = resolveLocale(input);
  if (resolved) return resolved.locale;
  // i18n not configured — return whatever the runtime knows, or
  // a hard-coded "en" fallback so this never throws.
  const config = getI18nConfig();
  return config?.defaultLocale ?? "en";
}

interface ParsedLanguageTag {
  tag: string;
  quality: number;
}

function parseAcceptLanguage(header: string): ParsedLanguageTag[] {
  return header
    .split(",")
    .map((entry) => {
      const [tagRaw, ...params] = entry.trim().split(";");
      if (!tagRaw) return null;
      const tag = tagRaw.trim().toLowerCase();
      let quality = 1;
      for (const param of params) {
        const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
        if (match) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed)) quality = parsed;
        }
      }
      return { tag, quality };
    })
    .filter((entry): entry is ParsedLanguageTag => entry !== null && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
}

function matchAcceptLanguage(
  header: string | undefined,
  configured: Set<string>,
): string | null {
  if (!header) return null;
  const parsed = parseAcceptLanguage(header);
  // Pre-compute lowercase configured locales so case-insensitive
  // matching works without lossy mutation of the configured set.
  const lowerToActual = new Map<string, string>();
  for (const loc of configured) lowerToActual.set(loc.toLowerCase(), loc);

  for (const { tag } of parsed) {
    if (lowerToActual.has(tag)) return lowerToActual.get(tag)!;
    // Try the primary subtag (`en-US` → `en`). Skip the wildcard.
    if (tag === "*") continue;
    const primary = tag.split("-")[0];
    if (primary && lowerToActual.has(primary)) return lowerToActual.get(primary)!;
  }
  return null;
}
