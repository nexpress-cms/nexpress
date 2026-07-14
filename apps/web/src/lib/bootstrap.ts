import { createBootstrap } from "@nexpress/next";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";
import { observabilityAdapters } from "@/lib/observability";

export const {
  getDb,
  ensureFor,
  reloadPlugins,
  shutdown: shutdownBootstrap,
} = createBootstrap({
  config: nexpressConfig,
  generatedSchema,
  ...observabilityAdapters,
});

export type { NpBootstrapIntent, NpDb } from "@nexpress/next";
export { nexpressConfig };
