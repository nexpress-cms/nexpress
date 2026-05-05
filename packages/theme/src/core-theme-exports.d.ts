declare module "@nexpress/core" {
  export type {
    NpThemeColors,
    NpThemeShape,
    NpThemeTokens,
    NpThemeTypography,
  } from "../../../core/src/theme/types.js";
  export type {
    NpThemeManifest,
    NpRegisteredTheme,
  } from "../../../core/src/config/types.js";
  export { DEFAULT_THEME } from "../../../core/src/theme/defaults.js";
  export { sanitizeTokenValue } from "../../../core/src/theme/sanitize.js";
  export {
    getActiveTheme,
    getRegisteredThemes,
    getThemeById,
  } from "../../../core/src/themes/registry.js";
}
