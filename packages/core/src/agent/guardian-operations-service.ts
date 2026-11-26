import { npReadAgentGuardianContentCoverageV1 } from "./guardian-content-coverage.js";
import type { NpAgentOperatorEventSourceV1 } from "./operator-event-source.js";
import { npRequireAgentGuardianOperatorCoverageV1 } from "../agent-contract/guardian-operator-coverage-contract.js";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, like, notInArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentNotifications,
  npAgentSignals,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodyInteger,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentIncidentStudioDetailV1,
  type NpAgentIncidentStudioDetailV1,
} from "../agent-contract/incident-studio-contract.js";
import {
  npAgentGuardianOperationsDetectorsV1,
  npAgentGuardianOperationsSourceIdsV1,
  npRequireAgentGuardianDiagnosticsV1,
  npRequireAgentGuardianIncidentExportV1,
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianDiagnosticsV1,
  type NpAgentGuardianIncidentExportV1,
  type NpAgentGuardianOperationsSourceIdV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import type { NpAgentIncidentStudioServiceV1 } from "./incident-studio-service.js";
import type { NpAgentIncidentStaffContextV1 } from "./incident-service.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
export interface NpAgentGuardianOperationsSourceV1 {
  id: NpAgentGuardianOperationsSourceIdV1;
  /** Actual host installation/key readiness, never inferred from the absence of rows. */
  readiness(input: { db: Db; siteId: string }): Promise<"enabled" | "disabled" | "unavailable">;
  verifyEvent?(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
}
export interface NpAgentGuardianOperationsOptionsV1 {
  studio: Pick<NpAgentIncidentStudioServiceV1, "get">;
  /** Existing staff/site operations admission. Factory installation grants no authority. */
  authorizeDiagnostics(input: Staff & { db: Db }): Promise<void>;
  sources?: readonly NpAgentGuardianOperationsSourceV1[];
  /** Same explicitly installed Operator owner used by Runtime jobs; no new polling or detectors. */
  operator?: Pick<NpAgentOperatorEventSourceV1, "coverage">;
  now?: () => Date;
}
export interface NpAgentGuardianOperationsServiceV1 {
  exportIncident(
    input: Staff & { incidentId: string; expectedVersion: number },
  ): Promise<NpAgentGuardianIncidentExportV1>;
  diagnostics(input: Staff): Promise<NpAgentGuardianDiagnosticsV1>;
}
function unavailable(code = "GUARDIAN_OPERATIONS_UNAVAILABLE", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Guardian operations evidence is unavailable.");
}
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const checksum = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const kinds: Record<NpAgentGuardianOperationsSourceIdV1, string[]> = {
  requests: ["auth.login.failed", "auth.login.succeeded", "api.rate-limited"],
  "security-transitions": [
    "security.authority.changed",
    "agent.policy.changed",
    "security.credential.changed",
    "security.plugin.changed",
  ],
  content: ["content.activity.observed"],
  sentry: ["security.error.signal"],
  runtime: ["agent.runtime.activity.observed"],
  http: ["http.response.observed"],
};
/** Build a new object exclusively from parsed staff projections; never serialize a Studio object. */
function project(
  detail: NpAgentIncidentStudioDetailV1,
  exportedAt: string,
): NpAgentGuardianIncidentExportV1 {
  if (
    detail.timelinePageComplete !== true ||
    detail.nextTimelineCursor !== null ||
    detail.signals.length !== detail.incident.signalIds.length ||
    !detail.signals.length
  )
    unavailable("GUARDIAN_EXPORT_INCOMPLETE");
  const sources: NpAgentGuardianIncidentExportV1["sources"] = [];
  for (const signal of detail.signals) {
    const known = npAgentGuardianOperationsDetectorsV1.find(
      (d) => d.id === signal.detectorId && d.version === signal.detectorVersion,
    );
    if (!known || !detail.incident.signalIds.includes(signal.id))
      unavailable("GUARDIAN_EXPORT_UNSUPPORTED_SOURCE");
    if (known.source === "requests") {
      if (signal.detectorId === "guardian.login-after-failures") {
        const proof = detail.guardianSessionEvidence?.find((p) => p.signalId === signal.id);
        if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
        sources.push({
          signalId: signal.id,
          source: known.source,
          startedAt: proof.window.startedAt,
          endedAt: proof.window.endedAt,
          observedCount: proof.precedingFailureCount + 1,
          countBasis: "at-least",
          sourceDigest: proof.sourceDigest,
          impact: "site",
          affectedSiteCount: 1,
        });
        continue;
      }
      const proof = detail.guardianEvidence?.find(
        (p) => p.signalId === signal.id && p.detectorId === signal.detectorId,
      );
      if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      sources.push({
        signalId: signal.id,
        source: known.source,
        startedAt: proof.window.startedAt,
        endedAt: proof.window.endedAt,
        observedCount: proof.observedCount,
        countBasis: "at-least",
        sourceDigest: null,
        impact: "site",
        affectedSiteCount: 1,
      });
    } else if (known.source === "security-transitions") {
      const proof = detail.guardianSecurityEvidence?.find(
        (p) => p.signalId === signal.id && p.detectorId === signal.detectorId,
      );
      if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      sources.push({
        signalId: signal.id,
        source: known.source,
        startedAt: proof.observedAt,
        endedAt: proof.observedAt,
        observedCount: 1,
        countBasis: "committed-transition",
        sourceDigest: proof.sourceDigest,
        impact: proof.impact.scope,
        affectedSiteCount: proof.impact.affectedSiteCount,
      });
    } else if (known.source === "content") {
      const proof = detail.guardianContentEvidence?.find(
        (p) => p.signalId === signal.id && p.detectorId === signal.detectorId,
      );
      if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      sources.push({
        signalId: signal.id,
        source: known.source,
        startedAt: proof.window.startedAt,
        endedAt: proof.window.endedAt,
        observedCount: proof.observedCount,
        countBasis: "at-least",
        sourceDigest: proof.sourceDigest,
        impact: "site",
        affectedSiteCount: 1,
      });
    } else if (known.source === "runtime" || known.source === "http") {
      const proof = (
        known.source === "runtime" ? detail.guardianRuntimeEvidence : detail.guardianHttpEvidence
      )?.find((p) => p.signalId === signal.id && p.detectorId === signal.detectorId);
      if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      sources.push({
        signalId: signal.id,
        source: known.source,
        startedAt: proof.window.startedAt,
        endedAt: proof.window.endedAt,
        observedCount: proof.observedCount,
        countBasis: "at-least",
        sourceDigest: proof.sourceDigest,
        impact: "site",
        affectedSiteCount: 1,
      });
    } else {
      const proof = detail.guardianExternalEvidence?.find(
        (p) => p.signalId === signal.id && p.detectorId === signal.detectorId,
      );
      if (!proof) unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      sources.push({
        signalId: signal.id,
        source: known.source,
        startedAt: proof.observedAt,
        endedAt: proof.observedAt,
        observedCount: 1,
        countBasis: "authenticated-external-fact",
        sourceDigest: proof.sourceDigest,
        impact: "site",
        affectedSiteCount: 1,
      });
    }
  }
  const incident = detail.incident;
  const body = {
    schemaVersion: "np.agent-guardian-incident-export.v1",
    exportedAt,
    completeness: "complete",
    incident: {
      id: incident.id,
      siteId: incident.siteId,
      versionNumber: incident.versionNumber,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      eventCount: incident.eventCount,
      firstObservedAt: incident.firstObservedAt,
      lastObservedAt: incident.lastObservedAt,
      createdAt: incident.createdAt,
      updatedAt: incident.updatedAt,
    },
    signals: detail.signals
      .map((s) => ({
        id: s.id,
        detectorId: s.detectorId,
        detectorVersion: s.detectorVersion,
        category: s.category,
        confidenceBasis: s.confidenceBasis,
        scoreBasisPoints: s.scoreBasisPoints,
        createdAt: s.createdAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    sources: sources.sort((a, b) => a.signalId.localeCompare(b.signalId)),
    outcomes: detail.timeline
      .map((entry) => {
        if (entry.kind === "agent_assessment" && !entry.guardianAssessment)
          unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
        const a = entry.guardianAssessment;
        return {
          id: entry.id,
          sequence: entry.sequence,
          kind: entry.kind,
          createdAt: entry.createdAt,
          assessment: a
            ? {
                disposition: a.disposition,
                confidenceBasisPoints: a.confidenceBasisPoints,
                assessmentCodes: a.assessmentCodes,
                evidenceDigests: a.evidenceDigests,
              }
            : null,
        };
      })
      .sort((a, b) => a.sequence - b.sequence),
  };
  return npRequireAgentGuardianIncidentExportV1({ ...body, checksum: checksum(body) });
}
/** Read-only local boundary. No source, route, worker, credential or provider is activated. */
export function createAgentGuardianOperationsServiceV1(
  options: NpAgentGuardianOperationsOptionsV1,
): NpAgentGuardianOperationsServiceV1 {
  if (
    typeof options.studio?.get !== "function" ||
    typeof options.authorizeDiagnostics !== "function" ||
    (options.now !== undefined && typeof options.now !== "function")
  )
    unavailable();
  const now = options.now ?? (() => new Date());
  const registrations = new Map<
    NpAgentGuardianOperationsSourceIdV1,
    NpAgentGuardianOperationsSourceV1
  >();
  for (const source of options.sources ?? []) {
    if (
      !npAgentGuardianOperationsSourceIdsV1.includes(source.id) ||
      registrations.has(source.id) ||
      typeof source.readiness !== "function" ||
      (source.verifyEvent !== undefined && typeof source.verifyEvent !== "function")
    )
      unavailable();
    registrations.set(source.id, {
      id: source.id,
      readiness: source.readiness.bind(source),
      ...(source.verifyEvent ? { verifyEvent: source.verifyEvent.bind(source) } : {}),
    });
  }
  return {
    async exportIncident(input) {
      canonicalBodySiteId(input.siteId, "guardian.operations.siteId");
      canonicalBodyUuid(input.incidentId, "guardian.operations.incidentId");
      canonicalBodyInteger(
        input.expectedVersion,
        "guardian.operations.expectedVersion",
        1,
        2147483647,
      );
      const readInput = { siteId: input.siteId, actor: input.actor, incidentId: input.incidentId };
      try {
        const first = npRequireAgentIncidentStudioDetailV1(await options.studio.get(readInput));
        if (
          first.incident.id !== input.incidentId ||
          first.incident.siteId !== input.siteId ||
          first.incident.versionNumber !== input.expectedVersion
        )
          unavailable("GUARDIAN_EXPORT_STALE_GENERATION");
        const time = now().toISOString();
        const output = project(first, time);
        const current = npRequireAgentIncidentStudioDetailV1(await options.studio.get(readInput));
        if (
          current.incident.id !== input.incidentId ||
          current.incident.siteId !== input.siteId ||
          current.incident.versionNumber !== input.expectedVersion ||
          !same(output, project(current, time))
        )
          unavailable("GUARDIAN_EXPORT_STALE_GENERATION");
        return output;
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw error;
        return unavailable("GUARDIAN_EXPORT_PROOF_UNAVAILABLE");
      }
    },
    async diagnostics(input) {
      canonicalBodySiteId(input.siteId, "guardian.operations.siteId");
      try {
        return await getDb().transaction(async (db) => {
          await db.execute(sql`set transaction read only`);
          const settings = await db.execute(
            sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_milliseconds`,
          );
          const inherited = Number(settings.rows[0]?.milliseconds);
          const inheritedLock = Number(settings.rows[0]?.lock_milliseconds);
          if (
            !Number.isFinite(inherited) ||
            inherited < 0 ||
            !Number.isFinite(inheritedLock) ||
            inheritedLock < 0
          )
            unavailable();
          const deadline = performance.now() + 2000;
          await db.execute(
            sql`select set_config('statement_timeout',${`${Math.min(inherited || 500, 500)}ms`},true),set_config('lock_timeout',${`${Math.min(inheritedLock || 100, 100)}ms`},true)`,
          );
          await options.authorizeDiagnostics({ ...input, db });
          const check = () => {
            if (performance.now() > deadline) unavailable("GUARDIAN_DIAGNOSTICS_LIMIT", 503);
          };
          const sources: NpAgentGuardianDiagnosticsV1["sources"] = [];
          for (const id of npAgentGuardianOperationsSourceIdsV1) {
            check();
            const source = registrations.get(id);
            const missing = (state: "unregistered" | "disabled" | "unavailable") => ({
              id,
              state,
              sampled: null,
              verified: null,
              proofUnavailable: null,
              truncated: false,
            });
            if (!source) {
              sources.push(missing("unregistered"));
              continue;
            }
            let readiness: "enabled" | "disabled" | "unavailable";
            try {
              readiness = await source.readiness({ db, siteId: input.siteId });
            } catch {
              readiness = "unavailable";
            }
            if (readiness !== "enabled" || !source.verifyEvent) {
              sources.push(missing(readiness === "disabled" ? "disabled" : "unavailable"));
              continue;
            }
            const rows = await db
              .select({
                id: npAgentEvents.id,
                eventHash: npAgentEvents.eventHash,
                occurredAt: npAgentEvents.occurredAt,
              })
              .from(npAgentEvents)
              .where(
                and(
                  eq(npAgentEvents.siteId, input.siteId),
                  inArray(npAgentEvents.kind, kinds[id]),
                  id === "sentry"
                    ? eq(npAgentEvents.sourceComponent, "sentry.issue-created.v1")
                    : undefined,
                ),
              )
              .orderBy(desc(npAgentEvents.recordedAt), desc(npAgentEvents.id))
              .limit(26);
            let verified = 0,
              proofUnavailable = 0;
            for (const row of rows.slice(0, 25)) {
              check();
              try {
                const proof = npRequireAgentGuardianVerifiedEventV1(
                  await source.verifyEvent({ db, siteId: input.siteId, eventId: row.id }),
                );
                if (
                  proof.eventId !== row.id ||
                  proof.source !== id ||
                  proof.sourceDigest !== row.eventHash ||
                  proof.observedAt !== row.occurredAt.toISOString()
                )
                  unavailable();
                verified++;
              } catch {
                proofUnavailable++;
              }
            }
            let confirmed: string;
            try {
              confirmed = await source.readiness({ db, siteId: input.siteId });
            } catch {
              confirmed = "unavailable";
            }
            if (confirmed !== "enabled") {
              sources.push(missing("unavailable"));
              continue;
            }
            sources.push({
              id,
              state: proofUnavailable || rows.length > 25 ? "partial" : "verified",
              sampled: Math.min(rows.length, 25),
              verified,
              proofUnavailable,
              truncated: rows.length > 25,
            });
          }
          check();
          const rows = await db
            .select()
            .from(npAgentSignals)
            .where(
              and(
                eq(npAgentSignals.siteId, input.siteId),
                like(npAgentSignals.detectorId, "guardian.%"),
              ),
            )
            .orderBy(desc(npAgentSignals.createdAt), desc(npAgentSignals.id))
            .limit(101);
          let invalid = 0,
            unsupported = 0;
          for (const row of rows.slice(0, 100)) {
            check();
            if (
              !npAgentGuardianOperationsDetectorsV1.some(
                (d) => d.id === row.detectorId && d.version === row.detectorVersion,
              )
            ) {
              unsupported++;
              continue;
            }
            try {
              await npReadAgentIncidentSignalEvidenceV1(row);
            } catch {
              invalid++;
            }
          }
          const critical = await db
            .select({ id: npAgentIncidents.id })
            .from(npAgentIncidents)
            .where(
              and(
                eq(npAgentIncidents.siteId, input.siteId),
                eq(npAgentIncidents.severity, "critical"),
                notInArray(npAgentIncidents.status, ["resolved", "dismissed"]),
                sql`exists(select 1 from ${npAgentSignals} s where s.site_id=${npAgentIncidents.siteId} and s.incident_id=${npAgentIncidents.id} and s.detector_id like 'guardian.%')`,
              ),
            )
            .orderBy(desc(npAgentIncidents.lastObservedAt))
            .limit(26);
          const failures = await db
            .select({ id: npAgentNotifications.id })
            .from(npAgentNotifications)
            .where(
              and(
                eq(npAgentNotifications.siteId, input.siteId),
                eq(npAgentNotifications.state, "failed"),
                sql`exists(select 1 from ${npAgentSignals} s where s.site_id=${npAgentNotifications.siteId} and s.incident_id=${npAgentNotifications.incidentId} and s.detector_id like 'guardian.%')`,
              ),
            )
            .orderBy(desc(npAgentNotifications.updatedAt))
            .limit(26);
          check();
          await options.authorizeDiagnostics({ ...input, db });
          check();
          const contentReceipts = await npReadAgentGuardianContentCoverageV1(db, input.siteId);
          const runtimeReceipts = await npReadAgentGuardianContentCoverageV1(
            db,
            input.siteId,
            "runtime",
          );
          const operatorCoverage = options.operator
            ? npRequireAgentGuardianOperatorCoverageV1(
                await options.operator.coverage({ db, siteId: input.siteId }),
              )
            : null;
          await options.authorizeDiagnostics({ ...input, db });
          check();
          return npRequireAgentGuardianDiagnosticsV1({
            schemaVersion: "np.agent-guardian-diagnostics.v1",
            siteId: input.siteId,
            observedAt: now().toISOString(),
            coverage: "bounded-sample",
            sources,
            contentReceipts,
            runtimeReceipts,
            operatorCoverage,
            detectors: npAgentGuardianOperationsDetectorsV1,
            signals: {
              sampled: Math.min(rows.length, 100),
              invalid,
              unsupported,
              truncated: rows.length > 100,
            },
            openCriticalIncidents: {
              observedCount: Math.min(critical.length, 25),
              truncated: critical.length > 25,
            },
            notificationFailures: {
              observedCount: Math.min(failures.length, 25),
              truncated: failures.length > 25,
            },
          });
        });
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw error;
        return unavailable("GUARDIAN_DIAGNOSTICS_UNAVAILABLE", 503);
      }
    },
  };
}
