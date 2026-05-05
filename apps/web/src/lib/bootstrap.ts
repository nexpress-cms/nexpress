import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

export const { getDb, ensureCoreServices, ensurePluginsLoaded, ensureJobProducer } =
  createBootstrap({
    config: nexpressConfig,
    generatedSchema: generatedSchema as unknown as Record<string, unknown>,
  });

export type { NpDb } from "@nexpress/next";
export { nexpressConfig };
