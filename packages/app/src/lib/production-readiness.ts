import { npReadStorageRuntimeConfig } from "@nexpress/core/storage";
import { npReadObservabilityRuntimeConfig } from "@nexpress/core/observability";

import { deployTargetTitle, type DeployTarget } from "../scripts/deploy-targets";

export interface CheckResult {
  id: string;
  state: "ok" | "warn" | "error";
  label: string;
  detail?: string;
  hint?: string;
  /** Exact plugin ownership for plugin-ops checks; omitted by other doctors. */
  pluginIds?: string[];
}

type ProductionReadinessEnv = Record<string, string | undefined>;

interface ProductionTopology {
  explicitMultiNode: boolean;
  explicitSingleNode: boolean;
  multiNodeDetail: string | null;
  singleNodeDetail: string | null;
  managedContainerHint: boolean;
}

export function checkProductionObservability(
  prodMode: boolean,
  env: ProductionReadinessEnv,
): CheckResult | null {
  if (!prodMode) return null;
  try {
    const config = npReadObservabilityRuntimeConfig(env);
    if (config.errorReporter === "noop") {
      return {
        id: "prod.observability",
        state: "warn",
        label: "Error reporting (production)",
        detail: `${config.logger} logger · noop error reporter`,
        hint: "Set NP_ERROR_REPORTER_ADAPTER=custom and pass a reporter to createBootstrap() so production exceptions leave the process.",
      };
    }
    return {
      id: "prod.observability",
      state: "ok",
      label: "Observability adapters (production)",
      detail: `${config.logger} logger · custom error reporter`,
    };
  } catch (error) {
    return {
      id: "prod.observability",
      state: "error",
      label: "Observability adapters (production)",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Set NP_LOGGER_ADAPTER to console or custom and NP_ERROR_REPORTER_ADAPTER to noop or custom.",
    };
  }
}

export function checkProductionStorage(
  prodMode: boolean,
  target: DeployTarget | null,
  env: ProductionReadinessEnv,
): CheckResult | null {
  if (!prodMode) return null;
  let adapter: "local" | "s3" | "custom";
  try {
    adapter = npReadStorageRuntimeConfig(env).adapter;
  } catch (error) {
    return {
      id: "prod.storage_adapter",
      state: "error",
      label: "Storage adapter (production)",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Fix the exact storage runtime contract before deployment.",
    };
  }
  const topology = detectProductionTopology(env);
  const containerHint = !topology.explicitSingleNode && topology.managedContainerHint;
  const genericMultiNodeCheck = !target || target === "docker";
  if (
    adapter === "local" &&
    (topology.explicitMultiNode || (genericMultiNodeCheck && containerHint))
  ) {
    return {
      id: "prod.storage_adapter",
      state: "error",
      label: "Storage adapter (production)",
      detail: `local + ${topology.multiNodeDetail ?? "managed-container env detected"}`,
      hint: "LocalStorageAdapter is per-process. Use S3, install a shared custom adapter, or set NP_MULTI_NODE=false / NP_REPLICAS=1 on a deliberate single-node deploy.",
    };
  }
  return {
    id: "prod.storage_adapter",
    state: "ok",
    label: `Storage adapter (production): ${adapter}`,
  };
}

export function checkTargetProductionStorage(
  prodMode: boolean,
  target: DeployTarget | null,
  env: ProductionReadinessEnv,
): CheckResult[] {
  if (!prodMode || !target) return [];
  let adapter: "local" | "s3" | "custom";
  try {
    adapter = npReadStorageRuntimeConfig(env).adapter;
  } catch (error) {
    return [
      {
        id: `target.${target}.storage`,
        state: "error",
        label: `${deployTargetTitle(target)} storage`,
        detail: error instanceof Error ? error.message : String(error),
        hint: "Fix the exact storage runtime contract before deployment.",
      },
    ];
  }
  const topology = detectProductionTopology(env);
  const targetTitle = deployTargetTitle(target);

  if (target === "vercel") {
    return [
      adapter === "s3" || adapter === "custom"
        ? {
            id: "target.vercel.storage",
            state: "ok",
            label: "Vercel storage",
            detail: adapter === "s3" ? "S3-compatible" : "custom adapter",
          }
        : {
            id: "target.vercel.storage",
            state: "error",
            label: "Vercel storage",
            detail: `NP_STORAGE_ADAPTER=${adapter}`,
            hint: "Vercel's filesystem is ephemeral. Use exact S3 configuration or install a shared custom adapter before deploy.",
          },
    ];
  }

  if ((target === "railway" || target === "render" || target === "fly") && adapter === "local") {
    return [
      {
        id: `target.${target}.storage`,
        state: topology.explicitSingleNode ? "warn" : "error",
        label: `${targetTitle} storage`,
        detail: topology.explicitSingleNode
          ? `local + ${topology.singleNodeDetail ?? "single-node override"}`
          : `local${topology.multiNodeDetail ? ` + ${topology.multiNodeDetail}` : " storage"}`,
        hint: topology.explicitSingleNode
          ? "Confirm the service has a persistent disk/volume and regular backups."
          : "Managed container filesystems are not durable across nodes/redeploys. Use S3 or a shared custom adapter, or set NP_MULTI_NODE=false / NP_REPLICAS=1 only for a deliberate single-node persistent-volume deploy.",
      },
    ];
  }

  return [
    {
      id: `target.${target}.storage`,
      state: "ok",
      label: `${targetTitle} storage`,
      detail: adapter,
    },
  ];
}

function detectProductionTopology(env: ProductionReadinessEnv): ProductionTopology {
  const replicaCount = parseReplicaCount(env.NP_REPLICAS);
  const multiNodeFlag = envFlagIsTrue(env.NP_MULTI_NODE);
  const replicaMultiNode = replicaCount !== null && replicaCount > 1;
  const explicitMultiNode = multiNodeFlag || replicaMultiNode;
  const singleNodeFlag = envFlagIsFalse(env.NP_MULTI_NODE);
  const replicaSingleNode = replicaCount === 1;
  const explicitSingleNode = !explicitMultiNode && (singleNodeFlag || replicaSingleNode);

  return {
    explicitMultiNode,
    explicitSingleNode,
    multiNodeDetail: multiNodeFlag
      ? `NP_MULTI_NODE=${env.NP_MULTI_NODE ?? "true"}`
      : replicaMultiNode
        ? `NP_REPLICAS=${replicaCount.toString()}`
        : null,
    singleNodeDetail: singleNodeFlag
      ? `NP_MULTI_NODE=${env.NP_MULTI_NODE ?? "false"}`
      : replicaSingleNode
        ? "NP_REPLICAS=1"
        : null,
    managedContainerHint: Boolean(
      env.KUBERNETES_SERVICE_HOST ||
      env.FLY_REGION ||
      env.RENDER_INSTANCE_ID ||
      env.RAILWAY_ENVIRONMENT_NAME,
    ),
  };
}

function envFlagIsTrue(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "true" || normalized === "1";
}

function envFlagIsFalse(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "false" || normalized === "0";
}

function parseReplicaCount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
