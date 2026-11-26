import { npCollectAgentGuardianContentCoverageV1 } from "./guardian-content-coverage.js";
import { getDb } from "../db/runtime.js";
import { sql } from "drizzle-orm";
import type { NpAgentDiagnosticsQueryClientV1 } from "./contract-diagnostics.js";
import {
  npRequireAgentGuardianHealthV1,
  type NpAgentGuardianHealthV1,
} from "../agent-contract/guardian-health-contract.js";
import {
  npAgentGuardianOperationsDetectorsV1,
  npAgentGuardianOperationsSourceIdsV1,
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianOperationsSourceIdV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import {
  NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1,
  npRequireAgentGuardianControlV1,
} from "../agent-contract/guardian-controls-contract.js";
import {
  npRequireAgentSignalEvidenceCanonical,
  npDigestAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { npValidateAgentGuardianControlStateV1 } from "./guardian-controls.js";

export interface NpAgentGuardianHealthProofOwnerV1 {
  source: NpAgentGuardianOperationsSourceIdV1;
  /** Actual local verifier/key readiness; never inferred from row counts. Disabled capture may
   * still supply a ready historical verifier. No credentials are loaded by the collector. */
  readiness(): Promise<"ready" | "disabled" | "unavailable">;
  /** Explicit closure over an existing host DB/source owner; no staff identity is fabricated. */
  verifyEvent(input: { siteId: string; eventId: string }): Promise<NpAgentGuardianVerifiedEventV1>;
}
export interface NpAgentGuardianHealthOptionsV1 {
  /** Caller owns this connection's query timeout. Use db for a scoped server query budget. */
  client?: NpAgentDiagnosticsQueryClientV1;
  /** Existing root handle, including Doctor's client-backed Drizzle handle; never a parent TX. */
  db?: ReturnType<typeof getDb>;
  proofOwners?: readonly NpAgentGuardianHealthProofOwnerV1[];
  now?: Date;
}
const sourceComponents: Record<NpAgentGuardianOperationsSourceIdV1, string[]> = {
  requests: ["auth.guardian", "api.guardian", "auth.guardian-session"],
  "security-transitions": [
    "guardian.authority.v1",
    "guardian.policy.v1",
    "guardian.credential.v1",
    "guardian.plugin.v1",
  ],
  content: ["guardian.content.v1"],
  sentry: ["sentry.issue-created.v1"],
  runtime: ["guardian.runtime.v1"],
  http: ["guardian.http.v1"],
};
const sourceKinds: Record<NpAgentGuardianOperationsSourceIdV1, string[]> = {
  requests: ["auth.login.failed", "api.rate-limited", "auth.login.succeeded"],
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
function iso(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string")
    throw new Error("Unavailable Guardian time");
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error("Unavailable Guardian time");
  return time.toISOString();
}
/** Fixed bounded aggregate reads. Does not initialize an application pool, source, worker, model
 * or key owner. Unknown proof coverage stays unavailable, even when zero rows are retained. */
export async function npCollectAgentGuardianHealthV1(
  options: NpAgentGuardianHealthOptionsV1 = {},
): Promise<NpAgentGuardianHealthV1> {
  const now =
    options.now instanceof Date && Number.isFinite(options.now.getTime())
      ? new Date(options.now)
      : new Date();
  const unknown: NpAgentGuardianHealthV1 = {
    schemaVersion: "np.agent-guardian-health.v1",
    generatedAt: now.toISOString(),
    windowStartedAt: new Date(now.getTime() - 86400000).toISOString(),
    state: "unavailable",
    coverage: "bounded-sample",
    detectors: npAgentGuardianOperationsDetectorsV1.map((d) => ({ ...d })),
    controls: {
      sampledSites: null,
      unconfigured: null,
      enabled: null,
      disabled: null,
      invalid: null,
      truncated: false,
    },
    recentSignals: { sampled: null, invalid: null, unsupported: null, truncated: false },
    currentCriticalIncidents: { observedCount: null, truncated: false },
    notificationFailures: { observedCount: null, truncated: false },
    contentReceipts: null,
    runtimeReceipts: null,
    proofs: npAgentGuardianOperationsSourceIdsV1.map((source) => ({
      source,
      registration: "unregistered",
      coverage: "unavailable",
      sampled: null,
      verified: null,
      unverifiable: null,
      truncated: false,
    })),
  };
  try {
    if (options.client && options.db) throw new Error("Ambiguous Guardian diagnostic handle");
    if (
      options.now !== undefined &&
      (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))
    )
      return npRequireAgentGuardianHealthV1(unknown);
    if (!options.client) {
      return await (options.db ?? getDb()).transaction(async (db) => {
        await db.execute(sql`set transaction read only`);
        const settings = await db.execute(
          sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_ms,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_ms`,
        );
        const statement = Number(settings.rows[0]?.statement_ms),
          lock = Number(settings.rows[0]?.lock_ms);
        if (!Number.isFinite(statement) || statement < 0 || !Number.isFinite(lock) || lock < 0)
          throw new Error("Invalid Guardian query budget");
        await db.execute(
          sql`select set_config('statement_timeout',${`${Math.min(statement || 500, 500)}ms`},true),set_config('lock_timeout',${`${Math.min(lock || 100, 100)}ms`},true)`,
        );
        const client: NpAgentDiagnosticsQueryClientV1 = {
          query: async <T extends Record<string, unknown>>(
            text: string,
            values: unknown[] = [],
          ) => {
            // Only this module's fixed SQL reaches this private adapter. Bind each
            // placeholder as a value; never interpolate a caller-controlled SQL string.
            const chunks = text
              .split(/(\$[1-9][0-9]*)/u)
              .map((part) =>
                /^\$[1-9][0-9]*$/u.test(part)
                  ? sql`${sql.param(values[Number(part.slice(1)) - 1])}`
                  : sql.raw(part),
              );
            const result = await db.execute(sql.join(chunks, sql.raw("")));
            return { rows: result.rows as T[] };
          },
        };
        return npCollectAgentGuardianHealthV1({ ...options, db: undefined, client, now });
      });
    }
    const client = options.client;
    if (typeof client?.query !== "function") return npRequireAgentGuardianHealthV1(unknown);
    const owners = new Map<
      NpAgentGuardianOperationsSourceIdV1,
      NpAgentGuardianHealthProofOwnerV1
    >();
    for (const owner of options.proofOwners ?? []) {
      if (
        !npAgentGuardianOperationsSourceIdsV1.includes(owner.source) ||
        owners.has(owner.source) ||
        typeof owner.readiness !== "function" ||
        typeof owner.verifyEvent !== "function"
      )
        throw new Error("Invalid Guardian verifier");
      owners.set(owner.source, {
        source: owner.source,
        readiness: owner.readiness.bind(owner),
        verifyEvent: owner.verifyEvent.bind(owner),
      });
    }
    const storage = await client.query(`/* np.guardian-health.storage.v1 */ select
      to_regclass('public.np_sites') is not null and to_regclass('public.np_settings') is not null
      and to_regclass('public.np_agent_signals') is not null and to_regclass('public.np_agent_events') is not null
      and to_regclass('public.np_agent_incidents') is not null and to_regclass('public.np_agent_notifications') is not null as available`);
    if (storage.rows.length !== 1 || storage.rows[0].available !== true)
      return npRequireAgentGuardianHealthV1(unknown);
    const [controlRows, signalRows, criticalRows, failureRows] = await Promise.all([
      client.query(
        `/* np.guardian-health.controls.v1 */ select site.id as site_id, setting.key is not null as configured,
        case when octet_length(setting.value::text)<=12288 then setting.value else null end as control
        from public.np_sites site left join public.np_settings setting on setting.site_id=site.id and setting.key=$1
        order by site.id limit 26`,
        [NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1],
      ),
      client.query(
        `/* np.guardian-health.signals.v1 */ select site_id,detector_id,detector_version,category,confidence_basis,score_basis_points,subject,evidence,evidence_digest,window_started_at,window_ended_at,created_at
        from public.np_agent_signals where detector_id like 'guardian.%' and created_at >= $1
        order by created_at desc,id desc limit 101`,
        [unknown.windowStartedAt],
      ),
      client.query(`/* np.guardian-health.critical.v1 */ select true as present from public.np_agent_incidents incident
        where incident.severity='critical' and incident.status not in ('resolved','dismissed')
        and exists(select 1 from public.np_agent_signals signal where signal.site_id=incident.site_id and signal.incident_id=incident.id and signal.detector_id like 'guardian.%')
        order by incident.last_observed_at desc,incident.id desc limit 26`),
      client.query(`/* np.guardian-health.notifications.v1 */ select true as present from public.np_agent_notifications notification
        where notification.state='failed' and exists(select 1 from public.np_agent_signals signal where signal.site_id=notification.site_id and signal.incident_id=notification.incident_id and signal.detector_id like 'guardian.%')
        order by notification.updated_at desc,notification.id desc limit 26`),
    ]);
    const controls = {
      sampledSites: Math.min(controlRows.rows.length, 25),
      unconfigured: 0,
      enabled: 0,
      disabled: 0,
      invalid: 0,
      truncated: controlRows.rows.length > 25,
    };
    for (const row of controlRows.rows.slice(0, 25)) {
      if (row.configured === false) {
        controls.unconfigured++;
        continue;
      }
      if (
        row.configured !== true ||
        typeof row.site_id !== "string" ||
        !npValidateAgentGuardianControlStateV1({ siteId: row.site_id, control: row.control })
      ) {
        controls.invalid++;
        continue;
      }
      const value = npRequireAgentGuardianControlV1(row.control);
      if (value.enabled) controls.enabled++;
      else controls.disabled++;
    }
    const recentSignals = {
      sampled: Math.min(signalRows.rows.length, 100),
      invalid: 0,
      unsupported: 0,
      truncated: signalRows.rows.length > 100,
    };
    for (const row of signalRows.rows.slice(0, 100)) {
      const detector = npAgentGuardianOperationsDetectorsV1.find(
        (d) => d.id === row.detector_id && d.version === row.detector_version,
      );
      if (!detector) {
        recentSignals.unsupported++;
        continue;
      }
      try {
        const createdAt = iso(row.created_at),
          endedAt = iso(row.window_ended_at);
        const category =
          detector.id === "guardian.rate-limits" || detector.source === "http"
            ? "traffic"
            : detector.id === "guardian.authority-escalated"
              ? "authorization"
              : detector.id === "guardian.policy-activated"
                ? "agent-abuse"
                : detector.source === "runtime"
                  ? "agent-abuse"
                  : detector.id === "guardian.plugin-changed"
                    ? "integrity"
                    : detector.source === "content"
                      ? "integrity"
                      : detector.source === "sentry"
                        ? "availability"
                        : "authentication";
        const canonical = npRequireAgentSignalEvidenceCanonical({
          schemaVersion: "np.agent-signal-evidence.v1",
          siteId: row.site_id,
          detectorId: row.detector_id,
          detectorVersion: row.detector_version,
          category: row.category,
          window: { startedAt: iso(row.window_started_at), endedAt },
          subject: row.subject,
          evidence: row.evidence,
        });
        if (
          row.category !== category ||
          row.confidence_basis !== (detector.source === "sentry" ? "external" : "exact-rule") ||
          row.score_basis_points !== null ||
          createdAt > unknown.generatedAt ||
          endedAt > createdAt ||
          (await npDigestAgentSignalEvidenceCanonical(canonical)) !== row.evidence_digest
        )
          throw new Error("Invalid Guardian signal");
      } catch {
        recentSignals.invalid++;
      }
    }
    const proofs: NpAgentGuardianHealthV1["proofs"] = [];
    const deadline = performance.now() + 2000;
    for (const source of npAgentGuardianOperationsSourceIdsV1) {
      const owner = owners.get(source);
      const unavailable = (
        registration: NpAgentGuardianHealthV1["proofs"][number]["registration"],
      ) => ({
        source,
        registration,
        coverage: "unavailable" as const,
        sampled: null,
        verified: null,
        unverifiable: null,
        truncated: false,
      });
      if (!owner) {
        proofs.push(unavailable("unregistered"));
        continue;
      }
      let readiness: "ready" | "disabled" | "unavailable";
      try {
        readiness = await owner.readiness();
      } catch {
        readiness = "unavailable";
      }
      if (readiness !== "ready" || performance.now() > deadline) {
        proofs.push(unavailable(readiness === "disabled" ? "disabled" : "unavailable"));
        continue;
      }
      const rows = await client.query(
        `/* np.guardian-health.proofs.v1 */ select id,site_id,occurred_at,event_hash from public.np_agent_events
        where source_component=any($1::text[]) and kind=any($2::text[]) order by recorded_at desc,id desc limit 26`,
        [sourceComponents[source], sourceKinds[source]],
      );
      let verified = 0,
        unverifiable = 0;
      for (const row of rows.rows.slice(0, 25)) {
        if (performance.now() > deadline) {
          unverifiable++;
          continue;
        }
        try {
          if (typeof row.site_id !== "string" || typeof row.id !== "string")
            throw new Error("Invalid Guardian source identity");
          const proof = npRequireAgentGuardianVerifiedEventV1(
            await owner.verifyEvent({ siteId: row.site_id, eventId: row.id }),
          );
          if (
            proof.source !== source ||
            proof.eventId !== row.id ||
            proof.sourceDigest !== row.event_hash ||
            proof.observedAt !== iso(row.occurred_at)
          )
            throw new Error("Unbound Guardian proof");
          verified++;
        } catch {
          unverifiable++;
        }
      }
      try {
        readiness = await owner.readiness();
      } catch {
        readiness = "unavailable";
      }
      if (readiness !== "ready") {
        proofs.push(unavailable(readiness === "disabled" ? "disabled" : "unavailable"));
        continue;
      }
      proofs.push({
        source,
        registration: "ready",
        coverage: unverifiable || rows.rows.length > 25 ? "partial" : "verified",
        sampled: Math.min(rows.rows.length, 25),
        verified,
        unverifiable,
        truncated: rows.rows.length > 25,
      });
    }
    const currentCriticalIncidents = {
        observedCount: Math.min(criticalRows.rows.length, 25),
        truncated: criticalRows.rows.length > 25,
      },
      notificationFailures = {
        observedCount: Math.min(failureRows.rows.length, 25),
        truncated: failureRows.rows.length > 25,
      };
    const contentReceipts = await npCollectAgentGuardianContentCoverageV1(client);
    const runtimeReceipts = await npCollectAgentGuardianContentCoverageV1(client, "runtime");
    const error = controls.invalid + recentSignals.invalid + recentSignals.unsupported > 0;
    const warning =
      runtimeReceipts.held > 0 ||
      runtimeReceipts.blocked > 0 ||
      runtimeReceipts.truncated ||
      contentReceipts.held > 0 ||
      contentReceipts.blocked > 0 ||
      contentReceipts.truncated ||
      controls.truncated ||
      recentSignals.truncated ||
      currentCriticalIncidents.observedCount > 0 ||
      currentCriticalIncidents.truncated ||
      notificationFailures.observedCount > 0 ||
      notificationFailures.truncated ||
      proofs.some((p) => p.coverage !== "verified");
    return npRequireAgentGuardianHealthV1({
      ...unknown,
      state: error ? "error" : warning ? "warn" : "ok",
      controls,
      recentSignals,
      currentCriticalIncidents,
      notificationFailures,
      contentReceipts,
      runtimeReceipts,
      proofs,
    });
  } catch {
    return npRequireAgentGuardianHealthV1(unknown);
  }
}
