import type { NpAgentOperatorSourceStatusV1 } from "@nexpress/core/agents";
import type { OpsBackupRestoreApplyJson } from "../../scripts/ops-backup-core";
import { collectOpsBackupReport } from "../../scripts/ops-backup-core";
import {
  npCollectAgentOperatorReportChecksV1,
  type NpAgentOperatorReportSourcesV1,
} from "./operator-report-sources";
import {
  checkCacheInvalidation,
  checkCollectionRuntime,
  checkObservabilityAdapters,
  checkSiteUrl,
  checkStorageAdapter,
} from "../system-health-checks";

/** Explicit source adapter; installation performs no reads or activation. Private path/error text is omitted. */
export function npCreateAgentOperatorAppStatusSourceV1(options: {
  backupEnv?: Record<string, string | undefined>;
  /** Explicit recent shipped Doctor/release artifacts; caller owns current deployment authority. */
  reportSources?: NpAgentOperatorReportSourcesV1;
  /** Existing backup operation owner may return its retained, completed result. Absent is unknown. */
  backupResult?: () => Promise<OpsBackupRestoreApplyJson | null>;
}) {
  return async function observeStatus(): Promise<NpAgentOperatorSourceStatusV1> {
    const checks = [
      checkSiteUrl(),
      checkCollectionRuntime(),
      checkObservabilityAdapters(),
      checkCacheInvalidation(),
      await checkStorageAdapter(),
    ];
    const projected: NpAgentOperatorSourceStatusV1["checks"] = checks.map((c) => ({
      id: c.id,
      state: c.state === "ok" ? "pass" : c.state === "error" ? "fail" : "warn",
    }));
    if (options.reportSources) {
      const reportChecks = await npCollectAgentOperatorReportChecksV1(options.reportSources);
      for (const c of reportChecks) {
        const state =
          c.state === "ok"
            ? ("pass" as const)
            : c.state === "error"
              ? ("fail" as const)
              : ("warn" as const);
        const prior = projected.find((check) => check.id === c.id);
        if (prior)
          prior.state =
            prior.state === "fail" || state === "fail"
              ? "fail"
              : prior.state === "warn" || state === "warn"
                ? "warn"
                : "pass";
        else projected.push({ id: c.id, state });
      }
    }
    let backup: NpAgentOperatorSourceStatusV1["backup"] = {
      state: "unknown",
      artifactId: null,
      stale: false,
      failed: false,
    };
    if (options.backupEnv) {
      try {
        const report = await collectOpsBackupReport({
          mode: "status",
          required: true,
          env: options.backupEnv,
          statusBounds: { maxManifests: 100, maxManifestBytes: 65536, maxDirectoryEntries: 1000 },
        });
        projected.push(
          ...report.checks.map((c) => ({
            id: c.id,
            state:
              c.state === "ok"
                ? ("pass" as const)
                : c.state === "error"
                  ? ("fail" as const)
                  : ("warn" as const),
          })),
        );
        // Freshness follows recorded manifests. Missing/unreadable storage is unknown, never a failed backup execution.
        if (report.checks.some((c) => c.id === "backup.observation_basis" && c.state === "ok"))
          backup = {
            state: "observed",
            artifactId: report.summary.latestId,
            stale: report.summary.stale,
            failed: false,
          };
      } catch {
        projected.push({ id: "backup.observation", state: "unknown" });
      }
    }
    if (options.backupResult) {
      const result = await options.backupResult();
      if (
        result &&
        result.schemaVersion === "np.ops-backup-restore-apply.v1" &&
        result.mutation.action === "backup.restore-apply" &&
        result.mutation.mode === "execute" &&
        result.mutation.approved === true &&
        result.mutation.completedAt !== null &&
        Number.isFinite(Date.parse(result.mutation.completedAt)) &&
        Date.parse(result.mutation.completedAt) <= Date.now() &&
        Date.now() - Date.parse(result.mutation.completedAt) <= 900000 &&
        Array.isArray(result.steps) &&
        result.steps.length <= 100 &&
        result.steps.some((s) => s.status === "failed")
      )
        backup = {
          ...backup,
          state: "observed",
          artifactId: result.manifestId,
          failed: true,
          failureReasonCode: "BACKUP_RESTORE_DRILL_FAILED",
        };
    }
    return { observedAt: new Date().toISOString(), checks: projected, backup };
  };
}
