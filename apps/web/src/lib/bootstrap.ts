import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

export const { getDb, ensureCoreServices, ensurePluginsLoaded } = createBootstrap({
  config: nexpressConfig,
  generatedSchema: generatedSchema as unknown as Record<string, unknown>,
});

export type { NxDb } from "@nexpress/next";
export { nexpressConfig };
