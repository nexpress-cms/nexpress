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
  getRegisteredPluginSchedules,
  runPluginScheduledTask,
  resetPlugins,
} from "./host.js";

export type {
  PluginHookHandler,
  PluginRouteHandler,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginAdminExtension,
  PluginScheduleHandler,
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
