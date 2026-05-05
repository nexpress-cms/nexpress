/**
 * Phase 11.5 — shared cookie + storage names for the dark-mode
 * preference. Centralized so the SSR cookie reader, the
 * inline early-init script, and the toggle component all agree.
 *
 * The cookie is read by the server layout to set
 * `<html data-theme="...">` for visitors with a saved choice.
 * The storage key is a fallback for users whose cookie was
 * cleared (private mode etc.) but kept localStorage. Each
 * value is the literal `"dark"` or `"light"`; missing means
 * "follow system preference".
 */
export const COLOR_SCHEME_COOKIE = "np-color-scheme";
export const COLOR_SCHEME_STORAGE_KEY = "np-color-scheme";

export type NpColorScheme = "dark" | "light";

export function isColorScheme(value: unknown): value is NpColorScheme {
  return value === "dark" || value === "light";
}
