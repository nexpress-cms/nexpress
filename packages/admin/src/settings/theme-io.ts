import {
  npMergeThemeTokens,
  npValidateThemeTokensOverlay,
  type NpThemeTokens,
} from "@nexpress/core/theme";

/**
 * Phase 11.6 — theme JSON export/import helpers, split out
 * of `theme-editor.tsx` so the parse/serialize logic is unit-
 * testable without mounting React.
 *
 * Parsed JSON is validated as an `NpThemeTokensOverlay` through the
 * client-safe core contract, then deeply merged onto the currently displayed
 * complete tree. Invalid keys and values fail instead of being normalized
 * away silently.
 */

export interface ParseResult {
  ok: true;
  theme: NpThemeTokens;
}

export interface ParseError {
  ok: false;
  reason: "invalid_json" | "not_an_object" | "no_theme_fields" | "invalid_contract";
  message?: string;
}

const REQUIRED_TOP_KEYS: ReadonlyArray<keyof NpThemeTokens> = ["colors", "typography", "shape"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * keys (`colors` / `typography` / `shape`) and every supplied group/key/value
 * satisfies the canonical overlay contract.
 *
 * The "no_theme_fields" guard catches cases like uploading an
 * unrelated JSON (e.g. a package.json) — the editor would
 * otherwise silently render the all-default theme and lose the
 * user's current state.
 */
export function parseImportedTheme(text: string, base: NpThemeTokens): ParseResult | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: "not_an_object" };
  }

  const candidate = isRecord(parsed.theme) ? parsed.theme : parsed;

  const hasAnyKey = REQUIRED_TOP_KEYS.some((key) => key in candidate);
  if (!hasAnyKey) {
    return { ok: false, reason: "no_theme_fields" };
  }

  const validation = npValidateThemeTokensOverlay(candidate);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid_contract",
      message: `${validation.issue.path}: ${validation.issue.message}`,
    };
  }

  return { ok: true, theme: npMergeThemeTokens(base, candidate) };
}

export const PARSE_ERROR_MESSAGES: Record<ParseError["reason"], string> = {
  invalid_json: "Invalid JSON file. Please pick a valid theme export.",
  not_an_object: "JSON file must contain a theme object at the top level.",
  no_theme_fields:
    "JSON does not look like a NexPress theme (missing colors / typography / shape).",
  invalid_contract: "Theme JSON does not match the NexPress token contract.",
};
