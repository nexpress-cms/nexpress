import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";
import {
  npVerifyGuardianSignalRuleV1,
  type NpGuardianSignalRuleVerificationV1,
} from "./guardian-signal-rule-verifier.js";
import { npReadAgentGuardianCaptureAdmissionV1 } from "./guardian-capture-admission.js";
import {
  npIsAgentGuardianSourceDeliveryClosedV1,
  npAssertAgentGuardianDeliveryKeyAvailableV1,
} from "./guardian-source-closure.js";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentSignals } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSites } from "../db/schema/system.js";
import { npUserRoles } from "../auth-contract/types.js";
import {
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentEventCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npRequireAgentGuardianSecurityEvidenceV1,
  npRequireAgentSecurityTransitionPayloadV1,
  npParseAgentSecurityAuthorityTransitionV1,
  npParseAgentSecurityPolicyTransitionV1,
  type NpAgentGuardianSecurityEvidenceV1,
  type NpAgentSecurityImpactV1,
  type NpAgentSecurityPolicyTransitionV1,
  type NpAgentSecurityTransitionPayloadV1,
} from "../agent-contract/guardian-security-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentGuardianVerifiedEventV1,
  type NpAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import type { NpAgentSubject } from "../agent-contract/types.js";
import type {
  NpSiteAuthorityMutationScopeV1,
  NpSiteAuthorityObserverV1,
} from "../sites/authority-observer.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { npReadAgentIncidentCanonicalSourcesV1 } from "./incident-source-evidence.js";
import {
  npObserveIncidentCandidate,
  type NpIncidentObservationCandidate,
} from "./incident-observation-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import type {
  NpGuardianSensitiveActorV1,
  NpGuardianSensitiveObserverV1,
} from "./guardian-sensitive-observer.js";
import {
  npRequireAgentSecurityCredentialTransitionV1,
  type NpAgentGuardianSourceStateCommitmentV1,
} from "../agent-contract/guardian-credential-contract.js";
import { npRequireAgentSecurityPluginTransitionV1 } from "../agent-contract/guardian-plugin-contract.js";
import { npPluginIdMaxLength, npPluginIdPattern } from "../plugins/id-contract.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
type Actor = NpGuardianSensitiveActorV1;
interface Prepared {
  transactionId: string;
  scope: NpSiteAuthorityMutationScopeV1;
  sites: readonly string[];
  impact: NpAgentSecurityImpactV1;
}
interface Receipt {
  schemaVersion: "np.agent-guardian-security-source.v1";
  keyId: string;
  eventId: string;
  eventHash: string;
  invocationId: string | null;
  sourceMac: string;
}
const SOURCE_ACTION = "agent.guardian_security.source";
const RECEIPT_SCHEMA = "np.agent-guardian-security-source.v1" as const;
const PROJECTION = "np.agent-guardian-security-principal.v1";
const digest = (value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const projectionFingerprint = digest({ schemaVersion: PROJECTION, algorithm: "hmac-sha256" });
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_SECURITY_EVIDENCE_UNAVAILABLE",
    409,
    "Security transition evidence is unavailable.",
  );
}
/** Source-only caps never become the owning membership/policy transaction's budget. */
async function withSourceBudget<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const result =
    await db.execute(sql`select current_setting('statement_timeout') as statement_original,
    extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_milliseconds,
    current_setting('lock_timeout') as lock_original,
    extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_milliseconds`);
  const row = result.rows[0];
  const statement = Number(row?.statement_milliseconds),
    lock = Number(row?.lock_milliseconds);
  if (
    typeof row?.statement_original !== "string" ||
    typeof row.lock_original !== "string" ||
    !Number.isFinite(statement) ||
    statement < 0 ||
    !Number.isFinite(lock) ||
    lock < 0
  )
    unavailable();
  const restore = () =>
    db.execute(sql`select set_config('statement_timeout',${row.statement_original},true),
    set_config('lock_timeout',${row.lock_original},true)`);
  let value: T;
  try {
    await db.execute(sql`select set_config('statement_timeout',${`${Math.min(statement || 500, 500)}ms`},true),
      set_config('lock_timeout',${`${Math.min(lock || 100, 100)}ms`},true)`);
    value = await work();
  } catch (error) {
    try {
      await restore();
    } catch {
      /* An aborted transaction restores its GUCs on rollback. */
    }
    throw error;
  }
  // A successful source must never silently leak its caps into its parent TX.
  await restore();
  return value;
}
function validKey(bytes: unknown): bytes is Uint8Array {
  return bytes instanceof Uint8Array && bytes.length >= 32 && bytes.length <= 64;
}
function keyId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
    unavailable();
  return value;
}
function component(policy: boolean): string {
  return policy ? "guardian.policy.v1" : "guardian.authority.v1";
}
function source(transition: NpAgentSecurityTransitionPayloadV1["transition"]) {
  if (transition.kind === "agent-policy")
    return { kind: "agent", component: component(true) } as const;
  if (transition.kind === "site-role" || transition.kind === "super-admin")
    return { kind: "auth", component: component(false) } as const;
  if (transition.kind === "plugin-activation" || transition.kind === "plugin-config")
    return { kind: "plugin", component: "guardian.plugin.v1" } as const;
  return { kind: "auth", component: "guardian.credential.v1" } as const;
}
function eventKind(
  transition: NpAgentSecurityTransitionPayloadV1["transition"],
): NpAgentSecurityTransitionPayloadV1["kind"] {
  if (transition.kind === "agent-policy") return "agent.policy.changed";
  if (transition.kind === "site-role" || transition.kind === "super-admin")
    return "security.authority.changed";
  return transition.kind === "plugin-activation" || transition.kind === "plugin-config"
    ? "security.plugin.changed"
    : "security.credential.changed";
}
function detector(payload: NpAgentSecurityTransitionPayloadV1) {
  return payload.kind === "security.credential.changed"
    ? "guardian.credential-changed"
    : payload.kind === "security.plugin.changed"
      ? "guardian.plugin-changed"
      : payload.kind === "agent.policy.changed"
        ? "guardian.policy-activated"
        : "guardian.authority-escalated";
}
function scope(value: NpSiteAuthorityMutationScopeV1): NpSiteAuthorityMutationScopeV1 {
  const raw = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "guardian.security.scope", 1024),
    "guardian.security.scope",
    value.kind === "site" ? ["kind", "siteId"] : ["kind"],
    value.kind === "site" ? ["kind", "siteId"] : ["kind"],
    { seen: new WeakSet<object>() },
  );
  return raw.kind === "site"
    ? { kind: "site", siteId: canonicalBodySiteId(raw.siteId, "guardian.security.siteId") }
    : raw.kind === "deployment"
      ? { kind: "deployment" }
      : unavailable();
}
function scopeKey(value: NpSiteAuthorityMutationScopeV1): string {
  return value.kind === "site" ? `site:${value.siteId}` : "deployment";
}
function actor(value: Actor): Actor {
  const keys =
    value.kind === "staff"
      ? ["kind", "userId"]
      : value.kind === "member"
        ? ["kind", "memberId"]
        : ["kind", "component"];
  const raw = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "guardian.security.actor", 1024),
    "guardian.security.actor",
    keys,
    keys,
    { seen: new WeakSet<object>() },
  );
  if (raw.kind === "staff")
    return { kind: "staff", userId: canonicalBodyUuid(raw.userId, "guardian.security.actor") };
  if (raw.kind === "member")
    return { kind: "member", memberId: canonicalBodyUuid(raw.memberId, "guardian.security.actor") };
  if (
    raw.kind !== "system" ||
    typeof raw.component !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(raw.component)
  )
    unavailable();
  return { kind: "system", component: raw.component };
}
function authorityNoop(value: unknown): boolean {
  const kind =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "kind")?.value as unknown)
      : undefined;
  if (kind === "site-role") {
    const keys = ["kind", "userId", "previousRole", "currentRole"];
    const raw = canonicalBodyRecord(value, "guardian.security.transition", keys, keys, {
      seen: new WeakSet<object>(),
    });
    canonicalBodyUuid(raw.userId, "guardian.security.userId");
    for (const role of [raw.previousRole, raw.currentRole])
      if (role !== null) canonicalBodyEnum(role, "guardian.security.role", new Set(npUserRoles));
    return raw.previousRole === raw.currentRole;
  }
  if (kind === "super-admin") {
    const keys = ["kind", "userId", "previous", "current"];
    const raw = canonicalBodyRecord(value, "guardian.security.transition", keys, keys, {
      seen: new WeakSet<object>(),
    });
    canonicalBodyUuid(raw.userId, "guardian.security.userId");
    if (typeof raw.previous !== "boolean" || typeof raw.current !== "boolean") unavailable();
    return raw.previous === raw.current;
  }
  return unavailable();
}
function detects(payload: NpAgentSecurityTransitionPayloadV1): boolean {
  if (payload.kind === "security.credential.changed" || payload.kind === "security.plugin.changed")
    return true;
  const t = payload.transition;
  if (t.kind === "agent-policy")
    return t.current.status === "active" && !same(t.previous, t.current);
  if (t.kind === "super-admin") return !t.previous && t.current;
  const rank = (role: (typeof npUserRoles)[number] | null) =>
    role === null ? -1 : npUserRoles.length - npUserRoles.indexOf(role);
  return rank(t.currentRole) > rank(t.previousRole);
}

export interface NpAgentGuardianSecurityObservationOptionsV1 {
  /** Copied host key; this factory creates or loads no credentials. */
  actorKey: { id: string; bytes: Uint8Array };
  /** Retained exact key id resolution. Absence never falls back to the current key. */
  resolveActorKey?(id: string): Uint8Array | null | Promise<Uint8Array | null>;
  isInstalledSite(siteId: string): Promise<boolean>;
  /** Trusted deployment/source policy, independent of requester prose or current historical role. */
  authorize(input: { db: Db; siteId: string }): Promise<void>;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  now?: () => Date;
}
export interface NpAgentGuardianSecurityObservationServiceV1 {
  /** Read-only immutable proof check; the caller owns current diagnostic/viewer authority. */
  verifySignal(input: NpGuardianSignalRuleVerificationV1): Promise<boolean>;
  verifyEvent(input: {
    db: Db;
    siteId: string;
    eventId: string;
  }): Promise<NpAgentGuardianVerifiedEventV1>;
  authorityObserver: NpSiteAuthorityObserverV1;
  sensitiveObserver: NpGuardianSensitiveObserverV1;
  preparePolicy(input: { db: Db; siteId: string }): Promise<void>;
  recordPolicy(input: {
    db: Db;
    siteId: string;
    actorUserId: string;
    invocationId: string;
    transitionId: string;
    occurredAt: Date;
    transition: NpAgentSecurityPolicyTransitionV1;
  }): Promise<void>;
  /** Caller separately owns current viewer/site/item authorization. */
  evidence(input: {
    db: Db;
    siteId: string;
    incident: NpAgentIncidentV1;
  }): Promise<NpAgentGuardianSecurityEvidenceV1[]>;
}

/** Explicit transaction-bound source. No registry, worker, model or recipe is installed. */
export function createAgentGuardianSecurityObservationServiceV1(
  options: NpAgentGuardianSecurityObservationOptionsV1,
): NpAgentGuardianSecurityObservationServiceV1 {
  const currentKeyId = keyId(options.actorKey?.id);
  if (
    !validKey(options.actorKey?.bytes) ||
    typeof options.isInstalledSite !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.events?.record !== "function"
  )
    unavailable();
  const currentKey = new Uint8Array(options.actorKey.bytes);
  const now = options.now ?? (() => new Date());
  const prepared = new WeakMap<Db, Map<string, Prepared>>();
  const projections = new WeakMap<
    NpAgentGuardianSourceStateCommitmentV1,
    {
      db: Db;
      transactionId: string;
      scope: NpSiteAuthorityMutationScopeV1;
      kind: string;
      targetId: string;
      keyId: string;
      mac: string;
    }
  >();
  const resolveKey = async (id: string): Promise<Uint8Array> => {
    if (id === currentKeyId) return currentKey;
    const bytes = await npAwaitAgentGuardianHostReadV1(() => options.resolveActorKey?.(id));
    if (!validKey(bytes)) unavailable();
    return new Uint8Array(bytes);
  };
  const mac = (key: Uint8Array, value: unknown) =>
    `hmac-sha256:${createHmac("sha256", key).update(RECEIPT_SCHEMA).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
  const subject = (
    siteId: string,
    userId: string,
    id: string,
    key: Uint8Array,
  ): NpAgentSubject => ({
    kind: "actor-bucket",
    purpose: "staff-principal",
    projectionVersion: 1,
    projectionFingerprint,
    keyId: id,
    bucket: createHmac("sha256", key)
      .update(serializeAgentCanonicalJson({ domain: PROJECTION, siteId, userId, keyId: id }))
      .digest("base64url"),
  });
  async function transactionId(db: Db): Promise<string> {
    const result = await db.execute(sql`select txid_current()::text as id`);
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !/^[1-9][0-9]{0,19}$/u.test(id)) unavailable();
    return id;
  }
  async function prepare(input: { db: Db; scope: NpSiteAuthorityMutationScopeV1 }): Promise<void> {
    npAssertAgentPreviewEffectsAllowed();
    const frozen = scope(input.scope);
    return withSourceBudget(input.db, async () => {
      const txId = await transactionId(input.db);
      const previous = prepared.get(input.db)?.get(scopeKey(frozen));
      if (previous?.transactionId === txId) return;
      if (frozen.kind === "deployment")
        await input.db.execute(sql`lock table np_sites in share mode`);
      const rows = await input.db
        .select({ id: npSites.id })
        .from(npSites)
        .where(frozen.kind === "site" ? eq(npSites.id, frozen.siteId) : undefined)
        .orderBy(asc(npSites.id))
        .limit(10_001);
      if (!rows.length || rows.length > 10_000) unavailable();
      const catalog = rows.map((row) => canonicalBodySiteId(row.id, "guardian.security.catalog"));
      const installed: string[] = [];
      for (const siteId of catalog)
        if ((await options.isInstalledSite(siteId)) === true) installed.push(siteId);
      const sites: string[] = [];
      for (const siteId of installed) {
        if ((await npReadAgentGuardianCaptureAdmissionV1(input.db, siteId)).state === "disabled")
          continue;
        await npWithAgentRuntimeControlTransactionV1(
          siteId,
          async ({ db }) => {
            if ((await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state === "disabled")
              return;
            await options.authorize({ db, siteId });
            sites.push(siteId);
          },
          input.db,
        );
      }
      const scopes = prepared.get(input.db) ?? new Map<string, Prepared>();
      scopes.set(scopeKey(frozen), {
        transactionId: txId,
        scope: frozen,
        sites,
        impact: {
          scope: frozen.kind,
          affectedSiteCount: catalog.length,
          siteCatalogDigest: digest({
            domain: "np.guardian-security-site-catalog.v1",
            sites: catalog,
          }),
        },
      });
      // Deployment preparation already acquired every installed site lock in
      // catalog order. Site projections reuse that preparation before domain locks.
      if (frozen.kind === "deployment")
        for (const siteId of catalog) {
          const localScope = { kind: "site" as const, siteId };
          scopes.set(scopeKey(localScope), {
            transactionId: txId,
            scope: localScope,
            sites: sites.includes(siteId) ? [siteId] : [],
            impact: {
              scope: "site",
              affectedSiteCount: 1,
              siteCatalogDigest: digest({
                domain: "np.guardian-security-site-catalog.v1",
                sites: [siteId],
              }),
            },
          });
        }
      prepared.set(input.db, scopes);
    });
  }
  async function requirePrepared(db: Db, value: NpSiteAuthorityMutationScopeV1): Promise<Prepared> {
    const p = prepared.get(db)?.get(scopeKey(value));
    if (!p || !same(p.scope, value) || p.transactionId !== (await transactionId(db))) unavailable();
    return p;
  }
  function receiptBase(row: EventRow, receipt: Pick<Receipt, "keyId" | "invocationId">) {
    return {
      schemaVersion: RECEIPT_SCHEMA,
      siteId: row.siteId,
      eventId: row.id,
      eventHash: row.eventHash,
      keyId: receipt.keyId,
      invocationId: receipt.invocationId,
    };
  }
  async function verify(db: Db, row: EventRow) {
    const event = await npReadAgentEventRowEvidenceV1(row);
    const payload = npRequireAgentSecurityTransitionPayloadV1(event.payload);
    const policy = payload.kind === "agent.policy.changed";
    const authority = payload.kind === "security.authority.changed";
    if (
      event.kind !== payload.kind ||
      !same(event.source, source(payload.transition)) ||
      event.privacy !== "sensitive" ||
      event.causation !== null ||
      event.correlationId !== null ||
      event.deduplicationKey !== `security:${payload.transitionId}` ||
      !event.actor ||
      (event.actor.kind !== "staff" &&
        event.actor.kind !== "system" &&
        !(
          event.actor.kind === "member" &&
          payload.kind === "security.credential.changed" &&
          payload.transition.kind === "password-replaced" &&
          payload.transition.audience === "member"
        ))
    )
      unavailable();
    const [audit] = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(eq(npAuditEvents.id, payload.sourceReceiptId), eq(npAuditEvents.siteId, row.siteId)),
      )
      .limit(1);
    if (!audit) unavailable();
    const keys = ["schemaVersion", "keyId", "eventId", "eventHash", "invocationId", "sourceMac"];
    const raw = canonicalBodyRecord(audit.payload, "guardian.security.receipt", keys, keys, {
      seen: new WeakSet<object>(),
    });
    const id = keyId(raw.keyId);
    const invocationId =
      raw.invocationId === null
        ? null
        : canonicalBodyUuid(raw.invocationId, "guardian.security.invocationId");
    const key = await resolveKey(id);
    const expected = receiptBase(row, { keyId: id, invocationId });
    if (
      raw.schemaVersion !== RECEIPT_SCHEMA ||
      raw.eventId !== row.id ||
      raw.eventHash !== row.eventHash ||
      typeof raw.sourceMac !== "string" ||
      !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(raw.sourceMac) ||
      !timingSafeEqual(Buffer.from(raw.sourceMac), Buffer.from(mac(key, expected))) ||
      audit.action !== SOURCE_ACTION ||
      audit.targetType !== "agent-event" ||
      audit.targetId !== row.id ||
      audit.createdAt.toISOString() !== event.occurredAt ||
      audit.actorKind !== event.actor.kind ||
      audit.actorUserId !== (event.actor.kind === "staff" ? event.actor.userId : null) ||
      audit.actorMemberId !== (event.actor.kind === "member" ? event.actor.memberId : null) ||
      (policy && (event.actor.kind !== "staff" || !invocationId)) ||
      (authority && invocationId !== null) ||
      !same(
        event.subject,
        payload.transition.kind === "site-role" || payload.transition.kind === "super-admin"
          ? subject(row.siteId, payload.transition.userId, id, key)
          : null,
      )
    )
      unavailable();
    if (
      payload.impact.scope === "site" &&
      payload.impact.siteCatalogDigest !==
        digest({ domain: "np.guardian-security-site-catalog.v1", sites: [row.siteId] })
    )
      unavailable();
    const targetIdentity =
      payload.transition.kind === "agent-policy"
        ? createHmac("sha256", key)
            .update(
              serializeAgentCanonicalJson({
                domain: "np.guardian-security-policy-target.v1",
                siteId: row.siteId,
                policyId: payload.transition.policyId,
                keyId: id,
              }),
            )
            .digest("base64url")
        : authority
          ? event.subject
          : createHmac("sha256", key)
              .update(
                serializeAgentCanonicalJson({
                  domain: "np.guardian-security-sensitive-target.v1",
                  siteId: row.siteId,
                  targetKind: payload.transition.kind,
                  targetId:
                    payload.transition.kind === "password-replaced"
                      ? payload.transition.principalId
                      : payload.transition.kind === "gateway-principal"
                        ? payload.transition.principalId
                        : payload.transition.kind === "gateway-token"
                          ? payload.transition.tokenId
                          : payload.transition.kind === "connection-credential"
                            ? payload.transition.connectionId
                            : payload.transition.kind === "plugin-activation" ||
                                payload.transition.kind === "plugin-config"
                              ? payload.transition.pluginId
                              : unavailable(),
                  keyId: id,
                }),
              )
              .digest("base64url");
    return { event, payload, invocationId, targetIdentity };
  }
  async function candidate(db: Db, row: EventRow): Promise<NpIncidentObservationCandidate> {
    const { payload, targetIdentity } = await verify(db, row);
    if (!detects(payload)) unavailable();
    const policy = payload.kind === "agent.policy.changed";
    const credential = payload.kind === "security.credential.changed",
      plugin = payload.kind === "security.plugin.changed";
    const startedAt = new Date(
      Math.floor(row.occurredAt.getTime() / 600_000) * 600_000,
    ).toISOString();
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId: row.siteId,
      detectorId: detector(payload),
      detectorVersion: 1,
      category: policy
        ? "agent-abuse"
        : plugin
          ? "integrity"
          : credential
            ? "authentication"
            : "authorization",
      subject: row.subject,
      window: { startedAt, endedAt: row.occurredAt.toISOString() },
      evidence: [
        {
          kind: "event",
          eventId: row.id,
          eventKind: row.kind,
          observedAt: row.occurredAt.toISOString(),
          digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
            "hex",
          ),
          excerpt: null,
        },
      ],
    });
    return {
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: digest({
        domain: "np.guardian-security-correlation.v1",
        siteId: row.siteId,
        detectorId: canonicalEvidence.detectorId,
        detectorVersion: 1,
        targetKind: payload.transition.kind,
        targetIdentity,
        startedAt,
      }),
      severity:
        credential || plugin ? "medium" : payload.impact.scope === "deployment" ? "high" : "medium",
      confidenceBasis: "exact-rule",
      scoreBasisPoints: null,
      title: credential
        ? "Credential state changed for review"
        : plugin
          ? "Plugin state changed for review"
          : policy
            ? "Agent policy activated for review"
            : "Staff authority increased for review",
      summary:
        credential || plugin
          ? "A committed state change was observed. Review its authorized purpose; this observation does not establish malicious intent or authorize a response."
          : policy
            ? "A committed Agent policy change is active. Review its authorized purpose; this observation does not establish abuse."
            : "A committed staff authority increase was observed. Review its authorized purpose; this observation does not establish malicious intent.",
    };
  }
  async function record(input: {
    db: Db;
    prepared: Prepared;
    actor: Actor;
    transitionId: string;
    occurredAt: Date;
    transition: NpAgentSecurityTransitionPayloadV1["transition"];
    invocationId: string | null;
  }): Promise<void> {
    const transitionId = canonicalBodyUuid(input.transitionId, "guardian.security.transitionId");
    const occurredAt = canonicalBodyUtc(
      input.occurredAt.toISOString(),
      "guardian.security.occurredAt",
    );
    const time = now();
    if (!Number.isFinite(time.getTime()) || Date.parse(occurredAt) > time.getTime()) unavailable();
    const eventSource = source(input.transition);
    for (const siteId of input.prepared.sites) {
      if (
        await npIsAgentGuardianSourceDeliveryClosedV1(
          input.db,
          siteId,
          "security-transitions",
          occurredAt,
        )
      )
        continue;
      if ((await options.isInstalledSite(siteId)) !== true) unavailable();
      await options.authorize({ db: input.db, siteId });
      const [previous] = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(
            eq(npAgentEvents.siteId, siteId),
            eq(npAgentEvents.sourceComponent, eventSource.component),
            eq(npAgentEvents.deduplicationKey, `security:${transitionId}`),
          ),
        )
        .limit(1);
      const payload = npRequireAgentSecurityTransitionPayloadV1({
        kind: eventKind(input.transition),
        transitionId,
        sourceReceiptId: previous
          ? npRequireAgentSecurityTransitionPayloadV1(previous.payload).sourceReceiptId
          : randomUUID(),
        impact: input.prepared.impact,
        transition: input.transition,
      });
      const previousProof = previous ? await verify(input.db, previous) : null;
      if (previousProof && previousProof.invocationId !== input.invocationId) unavailable();
      const event = npRequireAgentEventCanonical({
        version: "np.agent-event.v1",
        siteId,
        kind: payload.kind,
        occurredAt,
        source: eventSource,
        subject: previousProof
          ? previousProof.event.subject
          : input.transition.kind === "site-role" || input.transition.kind === "super-admin"
            ? subject(siteId, input.transition.userId, currentKeyId, currentKey)
            : null,
        actor: input.actor,
        causation: null,
        correlationId: null,
        deduplicationKey: `security:${transitionId}`,
        privacy: "sensitive",
        payload,
      });
      let row: EventRow;
      if (previous) {
        if (!same(previousProof?.event, event)) unavailable();
        row = previous;
      } else {
        await npAssertAgentGuardianDeliveryKeyAvailableV1(input.db, event, "security-transitions");
        const recorded = await options.events.record({ db: input.db, siteId, event });
        if (recorded.replayed) unavailable();
        const rows = await npReadAgentEventRowsV1(input.db, siteId, [recorded.eventId]);
        if (rows.length !== 1 || !same(await npReadAgentEventRowEvidenceV1(rows[0]), event))
          unavailable();
        row = rows[0];
        const base = receiptBase(row, { keyId: currentKeyId, invocationId: input.invocationId });
        await input.db.insert(npAuditEvents).values({
          id: payload.sourceReceiptId,
          siteId,
          actorKind: input.actor.kind,
          actorUserId: input.actor.kind === "staff" ? input.actor.userId : null,
          actorMemberId: input.actor.kind === "member" ? input.actor.memberId : null,
          action: SOURCE_ACTION,
          targetType: "agent-event",
          targetId: row.id,
          payload: {
            schemaVersion: RECEIPT_SCHEMA,
            keyId: currentKeyId,
            eventId: row.id,
            eventHash: row.eventHash,
            invocationId: input.invocationId,
            sourceMac: mac(currentKey, base),
          },
          createdAt: input.occurredAt,
        });
        await verify(input.db, row);
      }
      if (detects(payload)) {
        const detected = await candidate(input.db, row);
        await npObserveIncidentCandidate({
          transaction: input.db,
          candidate: detected,
          now: () => new Date(time),
          notifications: options.notifications,
          resolveEvidence: async (db) => {
            const rows = await npReadAgentEventRowsV1(db, siteId, [row.id]);
            if (rows.length !== 1) return false;
            const rebuilt = await candidate(db, rows[0]);
            return (
              same(rebuilt.canonicalEvidence, detected.canonicalEvidence) &&
              rebuilt.fingerprint === detected.fingerprint
            );
          },
        });
      }
      await input.db
        .update(npAgentEvents)
        // Source-owned Events are consumed in their recording transaction. Reuse
        // the persisted record time, as other Guardian sources do; a clock read
        // before events.record() can precede recordedAt and violate its fence.
        .set({ dispatchedAt: row.recordedAt })
        .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, row.id)));
    }
  }
  async function recordForScope(
    input: Omit<Parameters<typeof record>[0], "prepared">,
    value: NpSiteAuthorityMutationScopeV1,
  ): Promise<void> {
    // Reject missing preparation before touching DB state or installing budgets.
    const stored = prepared.get(input.db)?.get(scopeKey(value));
    if (!stored || !same(stored.scope, value)) unavailable();
    return withSourceBudget(input.db, async () =>
      record({ ...input, prepared: await requirePrepared(input.db, value) }),
    );
  }
  const sensitiveObserver: NpGuardianSensitiveObserverV1 = {
    prepare,
    async projectState(input) {
      npAssertAgentPreviewEffectsAllowed();
      const frozenScope = scope(input.scope),
        kind = input.kind,
        targetId = input.targetId,
        readState = input.readState;
      if (
        frozenScope.kind !== "site" ||
        typeof readState !== "function" ||
        ![
          "gateway-principal",
          "connection-credential",
          "plugin-activation",
          "plugin-config",
        ].includes(kind)
      )
        unavailable();
      if (kind === "connection-credential" || kind === "gateway-principal")
        canonicalBodyUuid(targetId, "guardian.security.targetId");
      else if (
        typeof targetId !== "string" ||
        targetId.length > npPluginIdMaxLength ||
        !new RegExp(npPluginIdPattern, "u").test(targetId)
      )
        unavailable();
      if (!prepared.get(input.db)?.has(scopeKey(frozenScope))) unavailable();
      return withSourceBudget(input.db, async () => {
        const p = await requirePrepared(input.db, frozenScope);
        const state = cloneCanonicalRuntimeInput(
          await readState(),
          "guardian.security.transientState",
          1_048_576,
        );
        const value = Object.freeze({
          keyId: currentKeyId,
          mac: `hmac-sha256:${createHmac("sha256", currentKey)
            .update("np.agent-guardian-sensitive-state.v1")
            .update("\0")
            .update(
              serializeAgentCanonicalJson({
                scope: frozenScope,
                kind,
                targetId,
                keyId: currentKeyId,
                state,
              }),
            )
            .digest("base64url")}`,
        });
        projections.set(value, {
          db: input.db,
          transactionId: p.transactionId,
          scope: frozenScope,
          kind,
          targetId,
          ...value,
        });
        return value;
      });
    },
    async recordCredential(input) {
      npAssertAgentPreviewEffectsAllowed();
      const transition = npRequireAgentSecurityCredentialTransitionV1(input.transition),
        frozenScope = scope(input.scope);
      if ((transition.kind === "password-replaced") !== (frozenScope.kind === "deployment"))
        unavailable();
      const proofs =
        transition.kind === "connection-credential" &&
        input.transition.kind === "connection-credential"
          ? [input.transition.previous.commitment, input.transition.current.commitment]
          : transition.kind === "gateway-principal" && input.transition.kind === "gateway-principal"
            ? [input.transition.previous.scopeCommitment, input.transition.current.scopeCommitment]
            : [];
      await recordSensitive(input, frozenScope, transition, proofs);
    },
    async recordPlugin(input) {
      npAssertAgentPreviewEffectsAllowed();
      const transition = npRequireAgentSecurityPluginTransitionV1(input.transition),
        frozenScope = scope(input.scope);
      if (frozenScope.kind !== "site") unavailable();
      const proofs = [
        ...(input.transition.previous ? [input.transition.previous.commitment] : []),
        input.transition.current.commitment,
      ];
      await recordSensitive(input, frozenScope, transition, proofs);
    },
  };
  async function recordSensitive(
    input:
      | Parameters<NpGuardianSensitiveObserverV1["recordCredential"]>[0]
      | Parameters<NpGuardianSensitiveObserverV1["recordPlugin"]>[0],
    frozenScope: NpSiteAuthorityMutationScopeV1,
    transition: NpAgentSecurityTransitionPayloadV1["transition"],
    proofs: NpAgentGuardianSourceStateCommitmentV1[],
  ) {
    const stored = prepared.get(input.db)?.get(scopeKey(frozenScope));
    if (!stored) unavailable();
    const frozenActor = actor(input.actor),
      occurredAt = new Date(input.occurredAt),
      invocationId =
        input.invocationId == null
          ? null
          : canonicalBodyUuid(input.invocationId, "guardian.security.invocationId");
    await withSourceBudget(input.db, async () => {
      const p = await requirePrepared(input.db, frozenScope);
      const targetId =
        transition.kind === "gateway-principal"
          ? transition.principalId
          : transition.kind === "connection-credential"
            ? transition.connectionId
            : transition.kind === "plugin-activation" || transition.kind === "plugin-config"
              ? transition.pluginId
              : null;
      for (const proof of proofs) {
        const owner = projections.get(proof);
        if (
          !owner ||
          owner.db !== input.db ||
          owner.transactionId !== p.transactionId ||
          !same(owner.scope, frozenScope) ||
          owner.kind !== transition.kind ||
          owner.targetId !== targetId ||
          owner.keyId !== proof.keyId ||
          owner.mac !== proof.mac
        )
          unavailable();
      }
      await record({
        db: input.db,
        prepared: p,
        actor: frozenActor,
        transitionId: input.transitionId,
        occurredAt,
        invocationId,
        transition,
      });
    });
  }
  return {
    sensitiveObserver,
    authorityObserver: {
      prepare,
      async record(input) {
        npAssertAgentPreviewEffectsAllowed();
        const raw = cloneCanonicalRuntimeInput(
          input.transition,
          "guardian.security.transition",
          4096,
        );
        if (authorityNoop(raw)) return;
        const transition = npParseAgentSecurityAuthorityTransitionV1(
          raw,
          "guardian.security.transition",
          { seen: new WeakSet<object>() },
        );
        const frozenScope = scope(input.scope);
        if ((transition.kind === "super-admin") !== (frozenScope.kind === "deployment"))
          unavailable();
        const frozen = {
          ...input,
          transition,
          actor: actor(input.actor),
          occurredAt: new Date(input.occurredAt),
          invocationId: null,
        };
        await recordForScope(frozen, frozenScope);
      },
    },
    preparePolicy: ({ db, siteId }) => prepare({ db, scope: { kind: "site", siteId } }),
    async recordPolicy(input) {
      npAssertAgentPreviewEffectsAllowed();
      const frozenScope = scope({ kind: "site", siteId: input.siteId });
      const invocationId = canonicalBodyUuid(input.invocationId, "guardian.security.invocationId");
      const keys = ["kind", "policyId", "agentId", "previous", "current"];
      const raw = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(input.transition, "guardian.security.transition", 8192),
        "guardian.security.transition",
        keys,
        keys,
        { seen: new WeakSet<object>() },
      );
      const noOp = same(raw.previous, raw.current);
      const transition = npParseAgentSecurityPolicyTransitionV1(
        noOp ? { ...raw, previous: null } : raw,
        "guardian.security.transition",
        { seen: new WeakSet<object>() },
      );
      if (noOp) return;
      const frozen = {
        ...input,
        transition,
        actor: actor({ kind: "staff", userId: input.actorUserId }),
        occurredAt: new Date(input.occurredAt),
        invocationId,
      };
      await recordForScope(frozen, frozenScope);
    },
    async verifySignal(input) {
      return npVerifyGuardianSignalRuleV1(input, async (_row, ids) => {
        if (ids.length !== 1) return unavailable();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
        if (rows.length !== 1) return unavailable();
        return candidate(input.db, rows[0]);
      });
    },
    async verifyEvent(input) {
      canonicalBodySiteId(input.siteId, "guardian.security.siteId");
      canonicalBodyUuid(input.eventId, "guardian.security.eventId");
      const rows = await npReadAgentEventRowsV1(input.db, input.siteId, [input.eventId]);
      if (rows.length !== 1) unavailable();
      const { payload } = await verify(input.db, rows[0]);
      return npRequireAgentGuardianVerifiedEventV1({
        schemaVersion: "np.agent-guardian-verified-event.v1",
        eventId: rows[0].id,
        source: "security-transitions",
        observedAt: rows[0].occurredAt.toISOString(),
        sourceDigest: rows[0].eventHash,
        detectorId: !detects(payload) ? null : detector(payload),
      });
    },
    async evidence(input) {
      const sources = await npReadAgentIncidentCanonicalSourcesV1(input);
      if (!sources.signals.length || sources.signals.length > 100) unavailable();
      const stored = await input.db
        .select()
        .from(npAgentSignals)
        .where(
          and(
            eq(npAgentSignals.siteId, input.siteId),
            eq(npAgentSignals.incidentId, input.incident.id),
            inArray(npAgentSignals.id, input.incident.signalIds),
          ),
        );
      if (stored.length !== sources.signals.length) unavailable();
      const evidence: NpAgentGuardianSecurityEvidenceV1[] = [];
      for (const signal of stored) {
        const ref = signal.evidence[0];
        if (signal.evidence.length !== 1 || ref?.kind !== "event") unavailable();
        const rows = await npReadAgentEventRowsV1(input.db, input.siteId, [ref.eventId]);
        if (rows.length !== 1) unavailable();
        const { payload } = await verify(input.db, rows[0]);
        const rebuilt = await candidate(input.db, rows[0]);
        if (
          signal.evidenceDigest !== rebuilt.evidenceDigest ||
          signal.detectorId !== rebuilt.canonicalEvidence.detectorId ||
          signal.detectorVersion !== 1 ||
          signal.severity !== rebuilt.severity ||
          signal.confidenceBasis !== "exact-rule" ||
          signal.scoreBasisPoints !== null ||
          signal.fingerprint !== rebuilt.fingerprint ||
          input.incident.fingerprint !== rebuilt.fingerprint ||
          input.incident.category !== rebuilt.canonicalEvidence.category ||
          !same(input.incident.primarySubject, rebuilt.canonicalEvidence.subject)
        )
          unavailable();
        evidence.push(
          npRequireAgentGuardianSecurityEvidenceV1({
            schemaVersion: "np.agent-guardian-security-evidence.v1",
            signalId: signal.id,
            detectorId: signal.detectorId,
            detectorVersion: 1,
            basis: "committed-transition",
            targetKind: payload.transition.kind,
            observedAt: rows[0].occurredAt.toISOString(),
            sourceDigest: rows[0].eventHash,
            impact: payload.impact,
          }),
        );
      }
      return evidence.sort((a, b) => a.signalId.localeCompare(b.signalId));
    },
  };
}
