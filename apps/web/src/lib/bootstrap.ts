import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

export const { getDb, ensureCoreServices, ensurePluginsLoaded, ensureJobProducer, reloadPlugins } =
  createBootstrap({
    config: nexpressConfig,
    generatedSchema,
  });

export type { NpDb } from "@nexpress/next";
export { nexpressConfig };
