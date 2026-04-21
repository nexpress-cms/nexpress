import { loadPlugins } from "@nexpress/core";
import { readingTimePlugin } from "@nexpress/plugin-reading-time";

import { getDb } from "@/lib/db";

let pluginsLoaded = false;
let pluginsLoadingPromise: Promise<void> | null = null;

/**
 * Triggers the one-time wiring of core services (DB, media, storage, collection
 * registry). The work happens inside `getDb()` so any consumer that touches the
 * DB is guaranteed to see initialized services. This wrapper exists for call
 * sites that don't otherwise need the connection.
 */
export function ensureCoreServices(): void {
  getDb();
}

const enabledPlugins = [readingTimePlugin];

export async function ensurePluginsLoaded(
  plugins: Parameters<typeof loadPlugins>[0] = enabledPlugins,
): Promise<void> {
  if (pluginsLoaded) return;
  if (pluginsLoadingPromise) return pluginsLoadingPromise;

  pluginsLoadingPromise = (async () => {
    ensureCoreServices();
    await loadPlugins(plugins);
    pluginsLoaded = true;
  })();

  return pluginsLoadingPromise;
}
