import { npDigestAgentOpsStatusReportV1 } from "@nexpress/core/agent-contract";
import { getCollectionConfig, getCollectionZodSchema } from "@nexpress/core/collections";
import { NpError } from "@nexpress/core";
import type {
  NpAgentOperatorHostContextV1,
  NpAgentOperatorHostV1,
  NpAgentOperatorPlanArtifactV1,
  NpAgentReadCapabilityContextV1,
  NpAgentReadCapabilityExecutorsV1,
} from "@nexpress/core/agents";
import type {
  NpAgentAuditRunInputV1,
  NpAgentAuditCheckV1,
  NpAgentJsonObject,
  NpAgentOpsPlanInputV1,
  NpAgentPlanOnlyOpsPlanInputV1,
  NpAgentOpsStatusInputV1,
  NpAgentOpsStatusOutputV1,
  NpOpsStatusV1,
} from "@nexpress/core/agent-contract";
import { collectOpsBackupReport, collectOpsBackupRestorePlan } from "../../scripts/ops-backup-core";
import { collectRuntimeOpsPluginsStatus } from "../ops-plugins-runtime";
import {
  checkCacheInvalidation,
  checkCollectionRuntime,
  checkObservabilityAdapters,
  checkSiteUrl,
  checkStorageAdapter,
} from "../system-health";

type Family = NpAgentOpsStatusInputV1["families"][number];
type Check = NpOpsStatusV1["checks"][number];
type Request = NpAgentReadCapabilityContextV1 & {
  capabilityId: "ops.status" | "audit.run" | "ops.plan";
  input: NpAgentOpsStatusInputV1 | NpAgentAuditRunInputV1 | NpAgentOpsPlanInputV1;
};
/** A scoped owner returns only measured states and opaque, retained evidence references. */
export interface NpAgentOperatorScopedObservationV1 {
  state: "ok" | "warn" | "error";
  evidenceRefs: string[];
}
export interface NpAgentOperatorAppHostOptionsV1 {
  /** Must enforce current site, caller and selected collection/item visibility. */
  authorize(request: Request): Promise<void>;
  /** Explicitly maps this site/caller to permission to inspect the whole deployment. */
  authorizeDeployment?(request: Request): Promise<boolean>;
  scopedReaders?: Partial<
    Record<
      Family,
      (context: NpAgentReadCapabilityContextV1) => Promise<NpAgentOperatorScopedObservationV1>
    >
  >;
  auditReaders?: Partial<
    Record<
      "contracts" | "jobs" | "storage" | "plugins",
      (
        request: NpAgentOperatorHostContextV1 & { input: NpAgentAuditRunInputV1; auditId: string },
      ) => Promise<NpAgentOperatorScopedObservationV1>
    >
  >;
  /** Install the existing Core schema.get executor, retaining its current collection ACL. */
  readSchema?: NpAgentReadCapabilityExecutorsV1["schema.get"];
  /** Host configuration only: never taken from a capability input. */
  backupEnv?: Record<string, string | undefined>;
  /** Task-specific owners only. No automatic CLI invocation or generic status-derived plans. */
  planOwners?: Partial<
    Record<
      NpAgentPlanOnlyOpsPlanInputV1["action"],
      (
        request: NpAgentOperatorHostContextV1 & { input: NpAgentOpsPlanInputV1; planId: string },
      ) => Promise<NpAgentOperatorPlanArtifactV1>
    >
  >;
}
const labels: Record<Family, string> = {
  readiness: "Deployment configuration readiness",
  jobs: "Site jobs",
  storage: "Storage adapter configuration",
  backup: "Deployment backup manifests",
  plugins: "Deployment plugin registry",
  cache: "Deployment cache adapter",
  agents: "Site Agent operations",
};
function unavailable(): never {
  throw new NpError("The requested Operator owner is unavailable.", "OPERATOR_UNAVAILABLE", 503);
}
function observationState(states: Array<Check["state"]>): Check["state"] {
  return states.includes("error") ? "error" : states.includes("warn") ? "warn" : "ok";
}
function fixedCheck(family: Family, state?: Check["state"]): Check {
  return {
    id: `operator.${family}`,
    state: state ?? "warn",
    label: labels[family],
    detail:
      state === undefined
        ? "Scoped evidence is unavailable."
        : "Observed from the authorized existing owner; configuration checks do not verify external connectivity.",
  };
}
/** Explicit factory only; creating this adapter never enables an Agent, worker or provider. */
export function npCreateAgentOperatorAppHostV1(options: NpAgentOperatorAppHostOptionsV1) {
  async function readFamily(family: Family, request: Request): Promise<Check> {
    const scoped = options.scopedReaders?.[family];
    if (scoped) {
      const result = await scoped(request);
      if (!["ok", "warn", "error"].includes(result.state)) return fixedCheck(family);
      return fixedCheck(family, result.state);
    }
    if (!(await options.authorizeDeployment?.(request))) return fixedCheck(family);
    try {
      switch (family) {
        case "readiness":
          return fixedCheck(
            family,
            observationState([
              checkSiteUrl().state,
              checkObservabilityAdapters().state,
              checkCollectionRuntime().state,
            ]),
          );
        case "storage":
          return fixedCheck(family, (await checkStorageAdapter()).state);
        case "cache":
          return fixedCheck(family, checkCacheInvalidation().state);
        case "plugins":
          return fixedCheck(
            family,
            observationState(collectRuntimeOpsPluginsStatus().checks.map((check) => check.state)),
          );
        case "backup": {
          if (!options.backupEnv) return fixedCheck(family);
          const report = await collectOpsBackupReport({
            mode: "status",
            required: true,
            env: options.backupEnv,
          });
          return fixedCheck(
            family,
            report.status === "blocked" ? "error" : report.status === "attention" ? "warn" : "ok",
          );
        }
        default:
          return fixedCheck(family);
      }
    } catch {
      return fixedCheck(family);
    }
  }
  async function assertAccess(request: Parameters<NpAgentOperatorHostV1["assertAccess"]>[0]) {
    await options.authorize(request);
    if (request.capabilityId === "audit.run" && "families" in request.input) {
      for (const family of request.input.families) {
        if (
          family !== "contracts" &&
          family !== "jobs" &&
          family !== "storage" &&
          family !== "plugins"
        )
          unavailable();
        if (!options.auditReaders?.[family] && !(family === "contracts" && options.readSchema))
          unavailable();
      }
    }
    if (
      request.capabilityId === "ops.plan" &&
      "action" in request.input &&
      request.input.action === "restore.plan"
    ) {
      if (!(await options.authorizeDeployment?.(request))) unavailable();
    }
  }
  const host: NpAgentOperatorHostV1 = {
    assertAccess,
    async audit(request) {
      const authorization: Request = { ...request, capabilityId: "audit.run" };
      await options.authorize(authorization);
      const supported = new Set(["contracts", "jobs", "storage", "plugins"]);
      // Audit never upgrades a configuration-only check into a measured content or security audit.
      if (request.input.families.some((family) => !supported.has(family))) unavailable();
      const checks: NpAgentAuditCheckV1[] = [];
      let targets = 0;
      for (const family of request.input.families) {
        if (
          family !== "contracts" &&
          family !== "jobs" &&
          family !== "storage" &&
          family !== "plugins"
        )
          unavailable();
        if (family === "contracts" && !options.auditReaders?.contracts && options.readSchema) {
          if (
            request.input.collections.length === 0 ||
            targets + request.input.collections.length > request.input.maxTargets
          )
            unavailable();
          for (const slug of request.input.collections) {
            const schema = await options.readSchema({ selector: "collection", slug }, request);
            getCollectionZodSchema(getCollectionConfig(slug));
            checks.push({
              id: `operator.contracts.${targets.toString()}`,
              family,
              status: "pass" as const,
              evidenceRefs: [`schema:${schema.digest}`],
            });
            targets += 1;
          }
          continue;
        }
        const reader = options.auditReaders?.[family];
        if (!reader) unavailable();
        const observation = await reader({
          ...request,
          input: { ...request.input, maxTargets: request.input.maxTargets - targets },
        });
        targets += observation.evidenceRefs.length;
        if (
          !["ok", "warn", "error"].includes(observation.state) ||
          observation.evidenceRefs.length === 0 ||
          targets > request.input.maxTargets
        )
          unavailable();
        checks.push({
          id: `operator.${family}`,
          family,
          status:
            observation.state === "ok"
              ? ("pass" as const)
              : observation.state === "error"
                ? ("fail" as const)
                : ("warn" as const),
          evidenceRefs: observation.evidenceRefs,
        });
      }
      await options.authorize(authorization);
      return { checks };
    },
    async plan(request) {
      await assertAccess({ ...request, capabilityId: "ops.plan" });
      if (
        ["cache.revalidate", "agent.run.retry", "agent.run.cancel"].includes(request.input.action)
      )
        unavailable();
      const action = request.input.action as NpAgentPlanOnlyOpsPlanInputV1["action"];
      const owner = options.planOwners?.[action];
      if (owner) {
        const result = await owner(request);
        await assertAccess({ ...request, capabilityId: "ops.plan" });
        return result;
      }
      if (request.input.action !== "restore.plan" || !options.backupEnv) unavailable();
      const manifestId = request.input.target.manifestId;
      // Never interpolate model-supplied shell syntax, paths, or the moving "latest" alias.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(manifestId) || manifestId === "latest")
        unavailable();
      const artifact = await collectOpsBackupRestorePlan({ env: options.backupEnv, manifestId });
      if (artifact.manifest?.id !== manifestId || artifact.manifestId !== manifestId) unavailable();
      await assertAccess({ ...request, capabilityId: "ops.plan" });
      return {
        // JSON serialization matches the owner's public CLI artifact representation exactly.
        artifact: JSON.parse(JSON.stringify(artifact)) as NpAgentJsonObject,
        contractId: "ops.backup",
        projectCommand: `pnpm --silent run ops:backup -- restore-plan ${manifestId} --json`,
        checks: artifact.checks.map((check, index) => ({
          id: `backup.check.${index.toString()}`,
          status: check.state === "ok" ? "pass" : check.state === "error" ? "fail" : "warn",
        })),
      };
    },
  };
  return {
    ...host,
    async status(
      input: NpAgentOpsStatusInputV1,
      context: NpAgentReadCapabilityContextV1,
    ): Promise<NpAgentOpsStatusOutputV1> {
      const request: Request = { ...context, capabilityId: "ops.status", input };
      await options.authorize(request);
      let checks = await Promise.all(input.families.map((family) => readFamily(family, request)));
      await options.authorize(request);
      if (!(await options.authorizeDeployment?.(request))) {
        checks = checks.map((check, index) =>
          options.scopedReaders?.[input.families[index]]
            ? check
            : fixedCheck(input.families[index]),
        );
      }
      const errors = checks.filter((check) => check.state === "error").length;
      const warnings = checks.filter((check) => check.state === "warn").length;
      const report: NpOpsStatusV1 = {
        schemaVersion: "np.ops.v1",
        ok: errors === 0,
        status: errors > 0 ? "blocked" : warnings > 0 ? "attention" : "ready",
        summary: { total: checks.length, errors, warnings },
        checks,
        nextCommand: null,
        projectNextCommand: null,
      };
      return {
        schemaVersion: "np.agent-ops-status.v1",
        report,
        digest: await npDigestAgentOpsStatusReportV1(report),
      };
    },
  };
}
