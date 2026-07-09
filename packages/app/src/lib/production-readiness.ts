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

export function checkProductionStorage(
  prodMode: boolean,
  target: DeployTarget | null,
  env: ProductionReadinessEnv,
): CheckResult | null {
  if (!prodMode) return null;
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
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
      hint: "LocalStorageAdapter is per-process. Set NP_STORAGE_ADAPTER=s3 + NP_S3_BUCKET / NP_S3_REGION, or NP_MULTI_NODE=false / NP_REPLICAS=1 on a single-node deploy.",
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
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  const topology = detectProductionTopology(env);
  const targetTitle = deployTargetTitle(target);

  if (target === "vercel") {
    return [
      adapter === "s3"
        ? {
            id: "target.vercel.storage",
            state: "ok",
            label: "Vercel storage",
            detail: "S3-compatible",
          }
        : {
            id: "target.vercel.storage",
            state: "error",
            label: "Vercel storage",
            detail: `NP_STORAGE_ADAPTER=${adapter}`,
            hint: "Vercel's filesystem is ephemeral. Set NP_STORAGE_ADAPTER=s3 plus NP_S3_BUCKET / NP_S3_REGION before deploy; add NP_S3_ENDPOINT for R2, MinIO, or another non-AWS S3 provider.",
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
          : "Managed container filesystems are not durable across nodes/redeploys. Set NP_STORAGE_ADAPTER=s3, or set NP_MULTI_NODE=false / NP_REPLICAS=1 only for a deliberate single-node persistent-volume deploy.",
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
