import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";
import { observabilityAdapters } from "@/lib/observability";

export const { getDb, ensureCoreServices, ensurePluginsLoaded, ensureJobProducer, reloadPlugins } =
  createBootstrap({
    config: nexpressConfig,
    generatedSchema,
    ...observabilityAdapters,
  });

export type { NpDb } from "@nexpress/next";
export { nexpressConfig };
