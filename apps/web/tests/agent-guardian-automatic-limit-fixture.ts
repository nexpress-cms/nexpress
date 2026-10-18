import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NpAgentPolicyResolutionInputV1 } from "../../../packages/core/src/agent-contract/runtime-policy.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import type { NpAgentAutomaticGuardianLimitDeploymentV1 } from "../../../packages/core/src/agent-contract/automatic-guardian-limit-contract.js";
import type { NpAgentRestrictionAdapter } from "../../../packages/core/src/agent-contract/restriction-adapter-contract.js";
import type { NpAgentGuardianAutomaticResponseInputV1 } from "../../../packages/core/src/agent-contract/guardian-response-contract.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentGuardianObservationServiceV1,
  npReadAgentGuardianIncidentEvidenceV1,
} from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentWorkflowServiceV1 } from "../../../packages/core/src/agent/incident-workflow-service.js";
import {
  createAgentAutomaticGuardianLimitAuthorityV1,
  type NpAgentAutomaticGuardianLimitAuthorityOptionsV1,
} from "../../../packages/core/src/agent/automatic-guardian-limit-service.js";
import { createAgentGuardianResponseServiceV1 } from "../../../packages/core/src/agent/guardian-response-service.js";
import { createAgentPostgresRestrictionAdapterV1 } from "../../../packages/core/src/agent/guardian-restriction-adapter.js";
import { createAgentGuardianActorProjectionV1 } from "../../../packages/core/src/agent/guardian-actor-projection.js";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { npAgentSignals } from "../../../packages/core/src/db/schema/agent.js";
import { fixture, principalFixture, siteId } from "./agent-changeset-fixture.js";

const digest = `cj1:sha256:${"A".repeat(43)}`;
const actorKey = { id: "automatic-limit-actor-v1", bytes: new Uint8Array(32).fill(105) };
const receiptKey = { id: "automatic-limit-receipt-v1", bytes: new Uint8Array(32).fill(106) };
export async function guardianAutomaticLimitFixture(
  options: {
    escalate?: boolean;
    actionsPerHour?: number;
    activeRestrictions?: number;
    wrapAdapter?: (adapter: NpAgentRestrictionAdapter) => NpAgentRestrictionAdapter;
  } = {},
) {
  const f = await fixture();
  // Keep all real observations in one UTC window without ever backdating the real session.
  const state = {
    clock: new Date((Math.floor(Date.now() / 600000) + 1) * 600000 + 60000),
    qualified: true,
    allowRead: true,
    policyAllowed: true,
    enforceable: true,
    qualificationChecks: 0,
  };
  const now = () => new Date(state.clock);
  const p = await principalFixture(
    f,
    false,
    { now },
    ["incident:read", "security:execute"],
    "approved-execute",
  );
  const forbidden = () =>
    Promise.reject(new Error("Automatic Guardian fixture must not invoke Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: forbidden,
      retry: forbidden,
      withCurrentRun: forbidden,
      withRunAuthority: forbidden,
    },
    enqueueRun: forbidden,
    deploymentAuthority: {
      policyId: "automatic-limit-no-provider-test",
      fingerprint: digest,
      scopes: [],
    },
    now,
  });
  const sourceOptions = {
    actorKey,
    isInstalledSite: () => Promise.resolve(true),
    authorize: () => Promise.resolve(),
    events,
    now,
  };
  const source = createAgentGuardianObservationServiceV1({ ...sourceOptions, receiptKey });
  const observations: Parameters<typeof source.observe>[0][] = [];
  let incidentId: string | null = null;
  for (let index = 0; index < 5; index++) {
    const input = {
      kind: "login-failed" as const,
      siteId,
      observationId: randomUUID(),
      occurredAt: now().toISOString(),
      networkAddress: "192.0.2.144",
      loginIdentifier: "private-automatic@example.test",
      audience: "staff" as const,
    };
    observations.push(input);
    const result = await source.observe(input);
    if (result.disposition !== "recorded") throw new Error("Expected actual signed request Event");
    incidentId = result.incidentId ?? incidentId;
    state.clock = new Date(state.clock.getTime() + 1);
  }
  if (!incidentId) throw new Error("Expected actual request rule Incident");
  const incidentKey = incidentId;
  const canRead = async ({
    incident,
    context,
  }: Parameters<
    NonNullable<Parameters<typeof createAgentIncidentServiceV1>[0]["canReadStaffIncident"]>
  >[0]) => {
    if (!state.allowRead) return false;
    try {
      await npReadAgentGuardianIncidentEvidenceV1({
        db: context.transaction ?? f.db,
        siteId: context.siteId,
        incident,
      });
      return true;
    } catch {
      return false;
    }
  };
  const incidents = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(107),
    now,
    canReadIncident: async ({ incident, context }) => {
      if (!state.allowRead) return false;
      try {
        await npReadAgentGuardianIncidentEvidenceV1({
          db: context.transaction ?? f.db,
          siteId: context.siteId,
          incident,
        });
        return true;
      } catch {
        return false;
      }
    },
    canReadStaffIncident: canRead,
  });
  const staffInput = { siteId, actor: f.actor.actor, incidentId: incidentKey };
  const workflow = createAgentIncidentWorkflowServiceV1({
    reads: incidents.staff,
    canReviewContainment: () => false,
    now,
  });
  async function incident() {
    return (await incidents.staff.get({ incidentId: incidentKey }, staffInput)).incident;
  }
  async function escalate() {
    const current = await incident();
    return workflow.escalate({
      ...staffInput,
      command: {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: current.versionNumber,
        severity: "high",
        note: "Human reviewed the current actual request observations.",
        idempotencyKey: randomUUID(),
      },
    });
  }
  if (options.escalate !== false) await escalate();
  const [signal] = await f.db
    .select()
    .from(npAgentSignals)
    .where(and(eq(npAgentSignals.siteId, siteId), eq(npAgentSignals.incidentId, incidentKey)))
    .limit(1);
  if (!signal) throw new Error("Expected actual five-observation Signal");
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [{ capabilityId: "security.limitActor", mode: "guarded" }];
  rules.risk = {
    automaticActionMaximum: "reversible",
    requirePreviewAtOrAbove: null,
    requireRecentAuthAtOrAbove: null,
  };
  rules.automation.guardianLimitActorMinSeverity = "high";
  rules.automation.guardianRestrictionTtlSeconds = 120;
  const policy: NpAgentPolicyResolutionInputV1 = {
    autonomy: "guarded",
    capabilityModes: [...rules.capabilityModes],
    layers: [rules],
  };
  const deployment: NpAgentAutomaticGuardianLimitDeploymentV1 = {
    schemaVersion: "np.agent-automatic-guardian-limit-deployment.v1",
    policyId: "synthetic-trusted-qualification-fixture",
    policyVersion: 1,
    siteId,
    principalIds: [p.authentication.principal.id],
    rule: {
      kind: "staff-escalated-auth-rule.v1",
      detectorId: "guardian.login-failures",
      detectorVersion: 1,
      minimumSeverity: "high",
      maximumEvidenceAgeSeconds: 600,
      maximumEscalationAgeSeconds: 600,
    },
    actionScopes: ["auth.staff"],
    limits: {
      restrictionSeconds: 120,
      actionsPerHour: options.actionsPerHour ?? 5,
      activeRestrictions: options.activeRestrictions ?? 5,
    },
    // These local digests and the callback below are SYNTHETIC qualification evidence.
    // The request MACs, source rule, staff escalation, principal admission and adapter are real.
    // This fixture establishes implementation behavior, never production qualification/readiness.
    qualification: {
      source: "production-human-review",
      policyVersion: 1,
      reviewArtifactDigest: digest,
      legitimateImpactReviewArtifactDigest: digest,
      shadowArtifactDigest: digest,
      shadowStartedAt: new Date(now().getTime() - 15 * 86400000).toISOString(),
      shadowEndedAt: new Date(now().getTime() - 86400000).toISOString(),
      compensationTestArtifactDigest: digest,
    },
    issuedAt: new Date(now().getTime() - 1000).toISOString(),
    expiresAt: new Date(now().getTime() + 86400000).toISOString(),
  };
  function authority(
    requestObservations = source,
    callbacks: Partial<
      Pick<NpAgentAutomaticGuardianLimitAuthorityOptionsV1, "verifyDeployment" | "resolvePolicy">
    > = {},
  ) {
    return createAgentAutomaticGuardianLimitAuthorityV1({
      deployment,
      requestObservations,
      verifyDeployment: () => {
        state.qualificationChecks++;
        return Promise.resolve(state.qualified);
      },
      resolvePolicy: () =>
        Promise.resolve(
          state.policyAllowed
            ? policy
            : {
                ...policy,
                autonomy: "observe",
                capabilityModes: [{ capabilityId: "security.limitActor", mode: "observe" }],
              },
        ),
      ...callbacks,
    });
  }
  const authorized = authority();
  const postgres = createAgentPostgresRestrictionAdapterV1({ db: () => f.db, now });
  const adapter = options.wrapAdapter?.(postgres) ?? postgres;
  function response(
    automatic = true,
    selectedAuthority = authorized,
    admission = p.admission,
    resolveTransportAudience = (...args: Parameters<typeof p.gateway.getTransportAudience>) =>
      p.gateway.getTransportAudience(...args),
  ) {
    return createAgentGuardianResponseServiceV1({
      reads: incidents.staff,
      adapter,
      now,
      canEnforceSubject: () => Promise.resolve(state.enforceable),
      resolveApprovals: () => {
        throw new Error("Automatic limiting must not fabricate or consume a human Approval");
      },
      resolvePolicy: () =>
        Promise.resolve({
          policyDigest: digest,
          maximumDurationSeconds: 3600,
          approvalLifetimeSeconds: 600,
          allowedScopes: ["auth.staff"],
        }),
      canReviewIncidentAsStaffUser: () => state.allowRead,
      ...(automatic
        ? {
            automatic: {
              authority: selectedAuthority,
              admission,
              incidents,
              resolveTransportAudience,
            },
          }
        : {}),
    });
  }
  async function gatewayAdmission(
    resolveGatewaySettings: Parameters<
      typeof createAgentCapabilityAdmissionServiceV1
    >[0]["resolveGatewaySettings"],
  ) {
    const registry = await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1({
        cursorHmacKey: { id: "automatic-limit-no-provider", key: new Uint8Array(32).fill(107) },
        resolveBlockSchemas: () => [],
        resolveUser: () => f.actor.actor.user,
      }),
    );
    return createAgentCapabilityAdmissionServiceV1({ registry, resolveGatewaySettings, now });
  }
  const service = response();
  const command: NpAgentGuardianAutomaticResponseInputV1 = {
    schemaVersion: "np.agent-guardian-automatic-response-input.v1",
    incidentId: incidentKey,
    signalId: signal.id,
    expectedVersion: (await incident()).versionNumber,
    idempotencyKey: randomUUID(),
  };
  async function additionalCohort(networkAddress: string) {
    let nextIncidentId: string | null = null;
    for (let index = 0; index < 5; index++) {
      const result = await source.observe({
        kind: "login-failed",
        siteId,
        observationId: randomUUID(),
        occurredAt: now().toISOString(),
        networkAddress,
        loginIdentifier: "private-additional-automatic@example.test",
        audience: "staff",
      });
      if (result.disposition !== "recorded")
        throw new Error("Expected actual additional source Event");
      nextIncidentId = result.incidentId ?? nextIncidentId;
      state.clock = new Date(state.clock.getTime() + 1);
    }
    if (!nextIncidentId || nextIncidentId === incidentKey)
      throw new Error("Missing distinct actual Incident");
    const context = { ...staffInput, incidentId: nextIncidentId };
    const initial = (await incidents.staff.get({ incidentId: nextIncidentId }, context)).incident;
    await workflow.escalate({
      ...context,
      command: {
        schemaVersion: "np.agent-incident-severity-input.v1",
        expectedVersion: initial.versionNumber,
        severity: "high",
        note: "Staff reviewed a distinct actual request cohort.",
        idempotencyKey: randomUUID(),
      },
    });
    const current = (await incidents.staff.get({ incidentId: nextIncidentId }, context)).incident;
    const [nextSignal] = await f.db
      .select()
      .from(npAgentSignals)
      .where(and(eq(npAgentSignals.siteId, siteId), eq(npAgentSignals.incidentId, nextIncidentId)))
      .limit(1);
    if (!nextSignal) throw new Error("Missing actual additional Signal");
    const nextCommand: NpAgentGuardianAutomaticResponseInputV1 = {
      ...command,
      incidentId: nextIncidentId,
      signalId: nextSignal.id,
      expectedVersion: current.versionNumber,
      idempotencyKey: randomUUID(),
    };
    return { command: nextCommand, incident: current };
  }
  const subject = createAgentGuardianActorProjectionV1(actorKey).project({
    siteId,
    purpose: "network-address",
    value: "192.0.2.144",
  });
  const controls = createAgentGuardianControlsV1({ deploymentActorFingerprint: digest, now });
  async function check(scope: "auth.staff" | "auth.member" = "auth.staff", targetSite = siteId) {
    return adapter.check(
      {
        schemaVersion: "np.agent-restriction-check.v1",
        siteId: targetSite,
        subjects: [{ kind: "opaque_actor_bucket", ...subject }],
        actionScope: scope,
        observedAt: now().toISOString(),
      },
      { signal: AbortSignal.timeout(1000) },
    );
  }
  return {
    ...f,
    p,
    source,
    sourceOptions,
    observations,
    events,
    incidents,
    workflow,
    staffInput,
    incident,
    escalate,
    command,
    additionalCohort,
    authorized,
    authority,
    deployment,
    rules,
    policy,
    state,
    now,
    adapter,
    postgres,
    service,
    response,
    gatewayAdmission,
    check,
    controls,
  };
}
