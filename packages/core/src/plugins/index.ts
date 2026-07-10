export {
  loadPlugins,
  runHook,
  runHookAndCollect,
  getPluginRoutes,
  getPluginPageRoutes,
  getPluginRegistration,
  getAllPluginIds,
  getPluginAdminExtension,
  getPluginAdminActionDiagnostics,
  getRegisteredPluginActions,
  getCollectionTabsForSlug,
  getDashboardWidgetsFromPlugins,
  dispatchPluginAction,
  schedulePluginTask,
  getRegisteredPluginSchedules,
  runPluginScheduledTask,
  resetPlugins,
  isPluginEnabled,
  invalidatePluginEnabled,
} from "./host.js";

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
  listPluginStates,
  getPluginState,
  syncPluginRegistrations,
  updatePluginState,
} from "./persistence.js";

export type { NpPluginState, NpPluginStateUpdate } from "./persistence.js";

export { checkNexpressCompat, compareSemver, getFrameworkVersion, topoSort } from "./compat.js";
export type { NexpressCompatResult, SortedPlugins } from "./compat.js";
