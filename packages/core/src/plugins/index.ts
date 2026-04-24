export {
  loadPlugins,
  runHook,
  runHookAndCollect,
  getPluginRoutes,
  getPluginRegistration,
  getAllPluginIds,
  getPluginAdminExtension,
  getCollectionTabsForSlug,
  getDashboardWidgetsFromPlugins,
  dispatchPluginAction,
  schedulePluginTask,
  resetPlugins,
} from "./host.js";

export type {
  PluginHookHandler,
  PluginRouteHandler,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginAdminExtension,
  ResolvedCollectionTab,
  ResolvedDashboardWidget,
} from "./host.js";

export {
  listPluginStates,
  getPluginState,
  syncPluginRegistrations,
  updatePluginState,
} from "./persistence.js";

export type { NxPluginState, NxPluginStateUpdate } from "./persistence.js";
