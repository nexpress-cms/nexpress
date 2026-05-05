import type { NpThemeTokens } from "@nexpress/core";

/**
 * Phase 11.6 — theme JSON export/import helpers, split out
 * of `theme-editor.tsx` so the parse/serialize logic is unit-
 * testable without mounting React.
 *
 * The editor already has a `normalizeTheme()` that accepts an
 * arbitrary `unknown` and folds it into a valid `NpThemeTokens`
 * (filling missing keys with defaults). The import path here
 * reuses that contract — the only thing this layer adds is
 * "is this string parseable JSON containing an object at all?"
 * so a corrupt or unrelated file errors clearly instead of
 * silently producing the default theme.
 */

export interface ParseResult {
  ok: true;
  theme: NpThemeTokens;
}

export interface ParseError {
  ok: false;
  reason: "invalid_json" | "not_an_object" | "no_theme_fields";
}

const REQUIRED_TOP_KEYS: ReadonlyArray<keyof NpThemeTokens> = [
  "colors",
  "typography",
  "shape",
];

export function serializeTheme(theme: NpThemeTokens): string {
  return JSON.stringify(theme, null, 2);
}

export function downloadFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `nexpress-theme-${yyyy}-${mm}-${dd}.json`;
}

/**
 * Parse + sanity-check an imported JSON string.
 *
 * Returns `{ ok: true, theme }` only when the input parses to
 * an object that has at least one of the recognized top-level
 * keys (`colors` / `typography` / `shape`). The actual key-by-
 * key normalization happens in the editor's `normalizeTheme`
 * — we don't replicate it here because the editor already
 * holds the field metadata (`colorFields`, etc.).
 *
 * The "no_theme_fields" guard catches cases like uploading an
 * unrelated JSON (e.g. a package.json) — the editor would
 * otherwise silently render the all-default theme and lose the
 * user's current state.
 */
export function parseImportedTheme(
  text: string,
  normalize: (raw: unknown) => NpThemeTokens,
): ParseResult | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not_an_object" };
  }

  const candidate =
    "theme" in parsed && typeof (parsed as Record<string, unknown>).theme === "object"
      ? ((parsed as Record<string, unknown>).theme as Record<string, unknown>)
      : (parsed as Record<string, unknown>);

  const hasAnyKey = REQUIRED_TOP_KEYS.some((key) => key in candidate);
  if (!hasAnyKey) {
    return { ok: false, reason: "no_theme_fields" };
  }

  return { ok: true, theme: normalize(candidate) };
}

export const PARSE_ERROR_MESSAGES: Record<ParseError["reason"], string> = {
  invalid_json: "Invalid JSON file. Please pick a valid theme export.",
  not_an_object:
    "JSON file must contain a theme object at the top level.",
  no_theme_fields:
    "JSON does not look like a NexPress theme (missing colors / typography / shape).",
};
