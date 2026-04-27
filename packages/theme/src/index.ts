export { generateThemeCss } from "./generate-css.js";
export { NxThemeStyle } from "./provider.js";
export { NxColorSchemeScript } from "./color-scheme-script.js";
export {
  COLOR_SCHEME_COOKIE,
  COLOR_SCHEME_STORAGE_KEY,
  isColorScheme,
  type NxColorScheme,
} from "./color-scheme-keys.js";

export { DEFAULT_THEME, sanitizeTokenValue } from "@nexpress/core";
export type { NxThemeColors, NxThemeShape, NxThemeTokens, NxThemeTypography } from "@nexpress/core";

export { defineTheme } from "./define-theme.js";
export type {
  NxTheme,
  NxThemeImpl,
  NxThemeShellProps,
  NxThemeSlots,
  NxThemeTemplate,
  NxThemeTemplates,
  NxTemplateRenderProps,
} from "./define-theme.js";

export {
  getActiveTheme,
  getRegisteredThemes,
  getThemeById,
} from "./registry-typed.js";
