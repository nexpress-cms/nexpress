export {
  loadPlugins,
  runHook,
  runHookAndCollect,
  getPluginRoutes,
  getPluginPageRoutes,
  getPluginRegistration,
  getAllPluginIds,
  getPluginDiscoveryItems,
  getPluginDiscoveryDiagnostics,
  getPluginAdminExtension,
  getPluginAdminActionDiagnostics,
  getRegisteredPluginActions,
  getCollectionTabsForSlug,
  getDashboardWidgetsFromPlugins,
  dispatchPluginAction,
  schedulePluginTask,
  getRegisteredPluginSchedules,
  runPluginScheduledTask,
  teardownPlugins,
  resetPlugins,
  isPluginEnabled,
  invalidatePluginEnabled,
} from "./host.js";

export {
  npAnalyzePageTemplateRegistry,
  npValidatePageTemplateRegistry,
  npPageTemplateKeys,
} from "./template-contract.js";
export type {
  NpPageTemplateRenderProps,
  NpPageTemplateDefinition,
  NpPageTemplateRegistry,
  NpPageTemplateContractIssue,
  NpPluginTemplateRegistration,
} from "./template-contract.js";

export {
  npAnalyzePluginDefinitionContract,
  npAnalyzePluginI18nBundles,
  npPluginTranslationKeys,
  npValidatePluginVoidResult,
} from "./definition-contract.js";
export type {
  NpPluginDefinitionContractInput,
  NpPluginDefinitionContractIssue,
} from "./definition-contract.js";

export {
  npAnalyzePluginAdminActionContract,
  npCollectPluginAdminActionReferences,
  npValidatePluginActionResult,
} from "./admin-action-contract.js";

export type {
  NpPluginActionKind,
  NpPluginActionRegistrationConflict,
  NpPluginActionRegistrationSource,
  NpPluginAdminActionIssue,
  NpPluginAdminActionIssueCode,
  NpPluginAdminActionReference,
  NpRegisteredPluginAction,
} from "./admin-action-contract.js";

export {
  npIsPluginApiRouteMethod,
  npPluginApiRouteKey,
  npPluginApiRouteMethods,
  npValidatePluginApiRouteDefinition,
  npValidatePluginApiRoutePath,
  npValidatePluginApiRouteResponse,
} from "./api-route-contract.js";

export type {
  NpPluginApiRouteMethod,
  NpPluginApiRouteRequest,
  NpPluginApiRouteRequestMethod,
  NpPluginApiRouteResponse,
  NpPluginApiRouteUser,
  NpPluginApiRouteValidationResult,
} from "./api-route-contract.js";

export {
  npCompilePluginPageRoutePattern,
  npIsPluginPageRouteLocale,
  npIsPluginPageRouteSurface,
  npMatchPluginPageRoutePattern,
  npPluginPageRouteLocales,
  npPluginPageRouteSurfaces,
  npValidatePluginPageRouteDefinition,
  npValidatePluginPageRoutePattern,
} from "./page-route-contract.js";

export type {
  NpPluginPageRouteDefinition,
  NpPluginPageRouteLocale,
  NpPluginPageRouteMatcher,
  NpPluginPageRouteSurface,
  NpPluginPageRouteValidationResult,
} from "./page-route-contract.js";

export {
  npAnalyzePluginScheduledTasks,
  npValidatePluginCronExpression,
  npValidatePluginScheduledTaskDefinition,
  npValidatePluginScheduledTaskId,
  npValidatePluginScheduledTaskResult,
} from "./scheduled-task-contract.js";

export type {
  NpPluginScheduledTaskDefinition,
  NpPluginScheduledTaskIssue,
  NpPluginScheduledTaskIssueCode,
  NpPluginScheduledTaskValidationResult,
} from "./scheduled-task-contract.js";

export {
  npIsPluginHookName,
  npPluginHookNames,
  npValidatePluginHookData,
} from "./hook-contract.js";

export type {
  NpAuthAfterLoginHookData,
  NpAuthAfterRegisterHookData,
  NpAuthBeforeLogoutHookData,
  NpContentAfterCreateHookData,
  NpContentAfterDeleteHookData,
  NpContentAfterPublishHookData,
  NpContentAfterUpdateHookData,
  NpContentBeforeCreateHookData,
  NpContentBeforeDeleteHookData,
  NpContentBeforePublishHookData,
  NpContentBeforeUnpublishHookData,
  NpContentBeforeUpdateHookData,
  NpContentHookSource,
  NpMediaAfterUploadHookData,
  NpMediaBeforeUploadHookData,
  NpMediaUploadFile,
  NpMediaUploadResult,
  NpPluginDocument,
  NpReadonlyPluginDocument,
  NpPluginHookData,
  NpPluginHookDataMap,
  NpPluginHookName,
  NpPluginHookValidationResult,
  NpPluginLifecycleHookName,
  NpPluginMember,
  NpPluginUser,
  NpRenderHookData,
} from "./hook-contract.js";

export type {
  PluginHookHandler,
  NpHookCollectOptions,
  NpHookResultValidation,
  PluginRouteHandler,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginPageRouteEntry,
  PluginAdminExtension,
  PluginScheduleHandler,
  ResolvedCollectionTab,
  ResolvedDashboardWidget,
} from "./host.js";

export {
  getPluginConfig,
  getPluginConfigWithStatus,
  setPluginConfig,
  pluginConfigCacheTag,
  applyPluginConfigMigration,
  isVersionedPluginConfig,
} from "./config.js";

export type { NpPluginConfigResult, NpVersionedPluginConfig } from "./config.js";

export {
  registerPluginTemplates,
  unregisterPluginTemplates,
  resetPluginTemplates,
  getPluginTemplatesForCollection,
  getRegisteredPluginTemplates,
} from "./templates.js";
export type { NpRegisteredPluginTemplate } from "./templates.js";

export {
  listPluginStates,
  listEnabledPluginIds,
  listEnabledPluginSiteIds,
  getPluginState,
  syncPluginRegistrations,
  updatePluginState,
} from "./persistence.js";

export type { NpPluginState, NpPluginStateUpdate } from "./persistence.js";

export { checkNexpressCompat, compareSemver, getFrameworkVersion, topoSort } from "./compat.js";
export type { NexpressCompatResult, SortedPlugins } from "./compat.js";
