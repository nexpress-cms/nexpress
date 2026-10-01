import { getAllPluginIds } from "@nexpress/core";
import { npCollectOperatorJobsObservationV1 } from "@nexpress/core/jobs";
import { npObserveMediaStorageV1 } from "@nexpress/core/media";
import type { NpStorageAdapter } from "@nexpress/core/storage";
import type { NpAgentReadCapabilityContextV1 } from "@nexpress/core/agents";
import { collectRuntimeOpsPluginsStatus } from "../ops-plugins-runtime";

/** Explicit source selection by the initialized host; never installs adapters or workers. */
export interface NpAgentOperatorObservationOwnersV1 {
  jobs?: "pg-boss";
  storage?: {
    adapter: NpStorageAdapter;
    /** Select only currently visible media; this sample never attests the whole site inventory. */
    selectMedia(
      context: NpAgentReadCapabilityContextV1,
      maxTargets: number,
      collections: readonly string[],
    ): Promise<readonly string[]>;
    authorizeMedia(context: NpAgentReadCapabilityContextV1, mediaId: string): Promise<void>;
  };
  /** Inspect the actual in-process deployment registry, with separate deployment authorization. */
  plugins?: boolean;
}
export interface OperatorObservation {
  state: "ok" | "warn" | "error";
  targetCount: number;
  detail: string;
  /** Safe facts retained inline by the existing audit invocation, not opaque external objects. */
  evidenceRefs: string[];
}
export async function collectOperatorObservation(
  owners: NpAgentOperatorObservationOwnersV1,
  family: "jobs" | "storage" | "plugins",
  context: NpAgentReadCapabilityContextV1,
  maxTargets: number,
  collections: readonly string[] = [],
): Promise<OperatorObservation> {
  context.abortSignal.throwIfAborted();
  if (!Number.isSafeInteger(maxTargets) || maxTargets < 1 || maxTargets > 1000)
    throw new Error("Invalid observation bound.");
  if (family === "jobs" && owners.jobs === "pg-boss") {
    const result = await npCollectOperatorJobsObservationV1({ siteId: context.siteId, maxTargets });
    const state = result.failed
      ? "error"
      : result.state !== "observed" || !result.complete
        ? "warn"
        : "ok";
    return {
      state,
      targetCount: result.inspectedCount ?? 0,
      detail: `Retained 24-hour framework site-payload cohort: ${result.inspectedCount ?? "unknown"} jobs, ${result.failed ?? "unknown"} failed; ${result.complete ? "complete" : "partial or unavailable"}. Excludes custom, global and unattributed jobs; does not verify worker health.`,
      evidenceRefs: [
        "observation:jobs:v1",
        "basis:retained-pg-boss-cohort",
        "coverage:framework-site-payload",
        `observed:${result.generatedAt}`,
        `window-start:${result.windowStart}`,
        `state:${result.state}`,
        `complete:${result.complete}`,
        ...(
          [
            "inspectedCount",
            "created",
            "active",
            "retry",
            "completed",
            "failed",
            "cancelled",
            "oldestReadyAgeSeconds",
          ] as const
        ).map((key) => `fact:${key}:${result[key] ?? "unknown"}`),
        ...result.coveredQueues.map((queue) => `queue:${queue}`),
      ],
    };
  }
  if (family === "storage" && owners.storage) {
    const owner = owners.storage;
    const bound = Math.min(maxTargets, 100);
    const mediaIds = await owner.selectMedia(context, bound, collections);
    const result = await npObserveMediaStorageV1({
      siteId: context.siteId,
      mediaIds,
      maxTargets: bound,
      adapter: owner.adapter,
      authorizeMedia: async ({ mediaId }) => {
        context.abortSignal.throwIfAborted();
        await owner.authorizeMedia(context, mediaId);
        context.abortSignal.throwIfAborted();
      },
    });
    return {
      state: result.missingTargets > 0 ? "error" : result.status === "complete" ? "ok" : "warn",
      targetCount: result.attemptedTargets,
      detail: `Selected authorized media object existence: ${result.presentTargets} present, ${result.missingTargets} missing, ${result.unavailableObservations} unavailable; ${result.status}. This sample does not verify the whole inventory or content integrity.`,
      evidenceRefs: [
        "observation:storage:v1",
        "basis:selected-media-object-existence",
        `observed:${new Date().toISOString()}`,
        `state:${result.status}`,
        `fact:attempted:${result.attemptedTargets}`,
        `fact:checked:${result.checkedTargets}`,
        `fact:present:${result.presentTargets}`,
        `fact:missing:${result.missingTargets}`,
        `fact:unavailable:${result.unavailableObservations}`,
      ],
    };
  }
  if (family === "plugins" && owners.plugins) {
    // Budget entities, not strings in the receipt. No discovery, activation or plugin execution.
    const count = getAllPluginIds().length;
    if (count > maxTargets)
      return {
        state: "warn",
        targetCount: 0,
        detail:
          "Deployment plugin registry exceeds the selected bound; diagnostics were not collected.",
        evidenceRefs: [
          "observation:plugins:v1",
          "basis:deployment-runtime-registry",
          "complete:false",
          "state:bounded-out",
        ],
      };
    const report = collectRuntimeOpsPluginsStatus();
    const errors = report.checks.filter((check) => check.state === "error").length;
    const warnings = report.checks.filter((check) => check.state === "warn").length;
    return {
      state: errors ? "error" : warnings ? "warn" : "ok",
      targetCount: count,
      detail: `Deployment runtime registry: ${count} plugins, ${errors} diagnostic errors, ${warnings} warnings. This observes registration contracts, not plugin code security or external connectivity.`,
      evidenceRefs: [
        "observation:plugins:v1",
        "basis:deployment-runtime-registry",
        "complete:true",
        `observed:${new Date().toISOString()}`,
        `fact:plugins:${count}`,
        `fact:errors:${errors}`,
        `fact:warnings:${warnings}`,
      ],
    };
  }
  throw new Error("Operator observation source unavailable.");
}
