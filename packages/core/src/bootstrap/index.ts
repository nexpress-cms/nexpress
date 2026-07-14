/**
 * `@nexpress/core/bootstrap` — framework-host wiring boundary.
 *
 * These process-global setters and registries are required by integration
 * packages such as `@nexpress/next`. Site/application code should use
 * `createBootstrap().ensureFor(...)` and domain subpaths instead.
 */

export { createDbConnection, npCloseDbConnection, type NpDb } from "../db/connection.js";
export { getDb, getOptionalDb, resetDb, setDb } from "../db/runtime.js";

export { registerCollection, resetCollections } from "../collections/registry.js";

export {
  configureStorageRuntime,
  getOptionalStorageAdapter,
  npShutdownStorageAdapter,
  setStorageAdapter,
} from "../storage/index.js";

export { getOptionalJobQueue, setJobQueue } from "../jobs/queue.js";
export { startProducer, stopProducer } from "../jobs/worker.js";

export {
  listPluginStates,
  loadPlugins,
  resetPlugins,
  runHook,
  runHookAndCollect,
  syncPluginRegistrations,
  teardownPlugins,
} from "../plugins/index.js";

export { registerThemes, resetThemes } from "../themes/registry.js";
export { resetI18nConfig, setI18nConfig } from "../i18n/registry.js";
export { resetCurrentSiteResolver, setCurrentSiteResolver } from "../sites/context.js";
