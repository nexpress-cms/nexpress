declare module "@nexpress/core" {
  export type {
    NxThemeColors,
    NxThemeShape,
    NxThemeTokens,
    NxThemeTypography,
  } from "../../../core/src/theme/types.js";
  export type {
    NxThemeManifest,
    NxRegisteredTheme,
  } from "../../../core/src/config/types.js";
  export { DEFAULT_THEME } from "../../../core/src/theme/defaults.js";
  export { sanitizeTokenValue } from "../../../core/src/theme/sanitize.js";
  export {
    getActiveTheme,
    getThemeById,
  } from "../../../core/src/themes/registry.js";
}
