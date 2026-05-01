import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

const bootstrap = createBootstrap({
  config: nexpressConfig,
  generatedSchema: generatedSchema as unknown as Record<string, unknown>,
});

export const { getDb } = bootstrap;

/**
 * Single typed entry point for bootstrap initialization.
 *
 *   - `"read"`    — DB + storage + collections registered. Use for
 *                   read-only RSC pages and GET API routes.
 *   - `"plugins"` — read + plugin loading. Use when render or
 *                   response generation needs `runHook` to fire.
 *   - `"write"`   — plugins + pg-boss producer. Use for any
 *                   mutating API route, server action, or import.
 */
export type NxBootstrapIntent = "read" | "plugins" | "write";

export async function ensureFor(intent: NxBootstrapIntent): Promise<void> {
  bootstrap.ensureCoreServices();
  if (intent === "read") return;

  await bootstrap.ensurePluginsLoaded();
  if (intent === "plugins") return;

  await bootstrap.ensureJobProducer();
}

export type { NxDb } from "@nexpress/next";
export { nexpressConfig };
