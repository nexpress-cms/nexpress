import { createBootstrap, type NpDb } from "@nexpress/next";

import * as generatedSchema from "@/db/generated/collections";
import { createCommunityOperationsPilot } from "@/lib/community-operations-host";
import { observabilityAdapters } from "@/lib/observability";
import nexpressConfig from "@/nexpress.config";

export const communityPilot =
  process.env.NP_COMMUNITY_OPERATIONS_PILOT === "1"
    ? createCommunityOperationsPilot((): NpDb => getDb())
    : undefined;

export const {
  getDb,
  ensureFor,
  reloadPlugins,
  shutdown: shutdownBootstrap,
} = createBootstrap({
  config: nexpressConfig,
  generatedSchema,
  ...observabilityAdapters,
  agentStudioRuntime: communityPilot?.studio,
});

export type { NpBootstrapIntent, NpDb } from "@nexpress/next";
export { nexpressConfig };
