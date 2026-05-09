export { generateThemeCss } from "./generate-css.js";
export { NpThemeStyle } from "./provider.js";
export { NpColorSchemeScript } from "./color-scheme-script.js";
export {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  isColorScheme,
  type NpColorScheme,
} from "./color-scheme-keys.js";

export { DEFAULT_THEME, sanitizeTokenValue } from "@nexpress/core";
export type { NpThemeColors, NpThemeShape, NpThemeTokens, NpThemeTypography } from "@nexpress/core";

export { defineTheme } from "./define-theme.js";
export type {
  NpTheme,
  NpThemeImpl,
  NpThemeShellProps,
  NpThemeSlots,
  NpThemeTemplate,
  NpThemeTemplates,
  NpTemplateRenderProps,
  NpRouteRenderProps,
  NpThemeRoute,
  NpThemeArchives,
  NpThemeArchiveEntry,
  NpThemeDateArchiveEntry,
  NpThemeNavLocation,
  NpThemeErrorProps,
  NpThemeSeoHooks,
} from "./define-theme.js";

export { getActiveTheme, getRegisteredThemes, getThemeById } from "./registry-typed.js";
