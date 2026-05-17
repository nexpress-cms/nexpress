export {
  createAuthHelpers,
  type AuthCookieTokens,
  type AuthHelpers,
  type AuthRuntimeConfig,
  type CreateAuthHelpersOptions,
} from "./auth.js";

export {
  createMemberAuthHelpers,
  type MemberAuthCookieTokens,
  type MemberAuthHelpers,
  type MemberAuthRuntimeConfig,
  type CreateMemberAuthHelpersOptions,
} from "./member-auth.js";

export { npSuccessResponse, npErrorResponse, type NpApiError } from "./response.js";
export { readJsonBody } from "./safe-json.js";

export {
  collectThemeRoutes,
  dispatchThemeRoute,
  buildRouteRenderProps,
  dispatchPluginRoute,
  buildPluginRouteRenderProps,
  type NpThemeRouteMatch,
  type NpPluginRouteMatch,
} from "./route-dispatcher.js";

// Re-exported here so plugin authors can declare route
// components without taking a direct dep on `@nexpress/theme`
// (the type lives there for theme-route reasons but the SDK
// boundary plugins want is `@nexpress/next`).
export type { NpRouteRenderProps } from "@nexpress/theme";

export {
  getCachedThemeSettings,
  getCachedPluginConfig,
  cachedThemeFetch,
  cachedPluginFetch,
  type NpCachedThemeFetchOptions,
  type NpCachedPluginFetchOptions,
} from "./cache.js";

export {
  createCollectionHelpers,
  type CollectionHelpers,
  type CollectionHelpersOptions,
} from "./collections.js";

export {
  createRevisionHelpers,
  type RevisionHelpers,
  type RevisionHelpersOptions,
} from "./revisions.js";

export {
  revalidateCollection,
  defaultRevalidationRules,
  type CollectionRevalidationRule,
  type RevalidationMap,
} from "./revalidate.js";

export {
  canActorUseSite,
  createBootstrap,
  type Bootstrap,
  type BootstrapOptions,
  type NpDb,
} from "./bootstrap.js";

export { toClientCollectionConfig } from "./client-safe.js";

export {
  getCachedTheme,
  getCachedActiveTheme,
  getCachedActiveThemeId,
  getCachedNavigation,
  getCachedSite,
  themeCacheTag,
  navCacheTag,
  siteCacheTag,
  bustThemeCache,
} from "./cache.js";

export { resolveAvailableLocales } from "./locale-siblings.js";

export {
  createDefaultBlockRenderContext,
  createSiteScopedBlockRenderContext,
} from "./block-render-context.js";

export { NavMenu, type NpNavMenuProps } from "./nav-menu.js";

export { buildPageMetadata } from "./page-metadata.js";

export { getSiteMember } from "./site-member.js";

export { JsonLd } from "./json-ld.js";
