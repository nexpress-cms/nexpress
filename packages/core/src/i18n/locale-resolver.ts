import { npRequireResolveLocaleInput } from "../i18n-contract/contract.js";
import type { NpResolveLocaleInput, NpResolveLocaleResult } from "../i18n-contract/types.js";
import { getI18nConfig } from "./registry.js";

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
  const normalized = npRequireResolveLocaleInput(input);
  const config = getI18nConfig();
  if (!config) return null;
  const configured = new Set(config.locales);

  if (normalized.pathname) {
    const segments = normalized.pathname.split("/").filter(Boolean);
    const first = segments[0];
    if (first && configured.has(first)) {
      const remaining = segments.slice(1).join("/");
      const without = remaining.length > 0 ? `/${remaining}` : "/";
      return { locale: first, source: "path", pathnameWithoutLocale: without };
    }
  }

  const fromHeader = matchAcceptLanguage(normalized.acceptLanguage, configured);
  if (fromHeader) {
    return {
      locale: fromHeader,
      source: "header",
      pathnameWithoutLocale: normalized.pathname,
    };
  }

  return {
    locale: config.defaultLocale,
    source: "default",
    pathnameWithoutLocale: normalized.pathname,
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
  if (header.trim() === "") return [];
  const parsed: ParsedLanguageTag[] = [];
  for (const [index, rawEntry] of header.split(",").entries()) {
    const parts = rawEntry.trim().split(";");
    const rawTag = parts.shift()?.trim() ?? "";
    if (!rawTag) {
      throw new TypeError(`Invalid Accept-Language range at index ${index.toString()}.`);
    }
    let tag: string;
    if (rawTag === "*") tag = "*";
    else {
      try {
        tag = Intl.getCanonicalLocales(rawTag)[0]?.toLowerCase() ?? "";
      } catch {
        tag = "";
      }
      if (!tag) {
        throw new TypeError(
          `Invalid Accept-Language tag "${rawTag}" at index ${index.toString()}.`,
        );
      }
    }
    let quality = 1;
    if (parts.length > 1) {
      throw new TypeError(`Invalid Accept-Language parameters at index ${index.toString()}.`);
    }
    const qualityParameter = parts[0]?.trim();
    if (qualityParameter !== undefined) {
      const match = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/iu.exec(qualityParameter);
      if (!match) {
        throw new TypeError(`Invalid Accept-Language quality at index ${index.toString()}.`);
      }
      quality = Number(match[1]);
    }
    if (quality > 0) parsed.push({ tag, quality });
  }
  return parsed.sort((a, b) => b.quality - a.quality);
}

function matchAcceptLanguage(header: string | undefined, configured: Set<string>): string | null {
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
