import { loadPlugins } from "@nexpress/core";

import { getDb } from "@/lib/db";

let pluginsLoaded = false;

/**
 * Triggers the one-time wiring of core services (DB, media, storage, collection
 * registry). The work happens inside `getDb()` so any consumer that touches the
 * DB is guaranteed to see initialized services. This wrapper exists for call
 * sites that don't otherwise need the connection.
 */
export function ensureCoreServices(): void {
  getDb();
}

export async function ensurePluginsLoaded(plugins: Parameters<typeof loadPlugins>[0]): Promise<void> {
  if (pluginsLoaded) return;
  ensureCoreServices();
  await loadPlugins(plugins);
  pluginsLoaded = true;
}
