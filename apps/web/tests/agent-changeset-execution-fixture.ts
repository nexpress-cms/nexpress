import type { NpAgentApprovalServiceV1 } from "../../../packages/core/src/agent/approval-service.js";
import type { NpAgentApprovalDetailV1 } from "../../../packages/core/src/agent-contract/approval-contract.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import { grantSiteMembership, npSessions, npUsers, npSettings } from "@nexpress/core";
import { npAgentChangesetExecutions } from "../../../packages/core/src/db/schema/agent.js";
import type {
  NpAgentChangeSetServiceOptionsV1,
  NpAgentChangeSetActorV1,
} from "../../../packages/core/src/agent/changeset-service.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentCapabilityDescriptor,
} from "../../../packages/core/src/agent-contract/types.js";
import type { NpAgentChangeSetDraftInputV1 } from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
import type {
  NpAgentChangeSetApplyJobPayload,
  NpAgentChangeSetVerifyJobPayload,
  NpAgentChangeSetRollbackJobPayload,
} from "../../../packages/core/src/jobs-contract/types.js";
import {
  fixture,
  principalFixture,
  command,
  draft,
  previewConfiguration,
  previewStorageFixture,
  siteId,
} from "./agent-changeset-fixture.js";
import { seedUser } from "./harness.js";
const digest = `cj1:sha256:${"A".repeat(43)}`;
function binding(
  operation: "apply" | "schedule" | "rollback",
): NpAgentCapabilityRegistryCanonicalV1 {
  const descriptor: NpAgentCapabilityDescriptor = {
    schemaVersion: "np.agent-capability.v1",
    id: `changeset.${operation}`,
    contractVersion: 1,
    source: "core",
    title: "Reviewed execution",
    description: "Fixture execution binding; no executor installed.",
    requiredScopes: ["changeset:apply"],
    scopeDerivation: "changeset-resources",
    risk: "sensitive",
    approval: "human",
    effectProfiles: [
      {
        id: `changeset.${operation}`,
        kind: "mutation",
        reversibility: "compensatable",
        minimumGatewayExposure: "approved-execute",
        verifierId: "changeset.verify",
        compensatorId: "changeset.rollback",
      },
    ],
    bootstrapIntent: "write",
    execution: "durable",
    idempotency: "required",
    gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  };
  return {
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [
      {
        descriptor,
        implementationVersion: 1,
        effectProfiles: descriptor.effectProfiles.map((profile) => ({
          schemaVersion: "np.agent-effect-profile.v1",
          capabilityId: descriptor.id,
          capabilityContractVersion: 1,
          implementationVersion: 1,
          profileId: profile.id,
          kind: profile.kind,
          reversibility: profile.reversibility,
          minimumGatewayExposure: profile.minimumGatewayExposure,
          effectContractVersion: 1,
          verifierId: profile.verifierId,
          compensatorId: profile.compensatorId,
        })),
      },
    ],
  };
}

export async function executionFixture({
  intendedOperation = "apply",
  document = false,
  deferVerification = false,
  convergenceFails = false,
  distinctApprover = false,
  principalExposure,
  draftInput,
  deferRollback = false,
  rollbackWindowSeconds,
  inspectPostCommitEffect,
}: {
  intendedOperation?: "apply" | "schedule";
  document?: boolean;
  deferVerification?: boolean;
  convergenceFails?: boolean;
  distinctApprover?: boolean;
  principalExposure?: "propose" | "approved-execute";
  draftInput?: (
    context: Awaited<ReturnType<typeof fixture>>,
  ) => Promise<NpAgentChangeSetDraftInputV1>;
  deferRollback?: boolean;
  rollbackWindowSeconds?: number;
  inspectPostCommitEffect?: NonNullable<
    NpAgentChangeSetServiceOptionsV1["execution"]
  >["inspectPostCommitEffect"];
} = {}) {
  let time = new Date();
  let paused = false;
  const scheduledFor =
    intendedOperation === "schedule" ? new Date(time.getTime() + 120_000).toISOString() : null;
  const { adapter } = previewStorageFixture(),
    configuration = previewConfiguration();
  const applyJobs: NpAgentChangeSetApplyJobPayload[] = [],
    verifyJobs: NpAgentChangeSetVerifyJobPayload[] = [],
    rollbackJobs: NpAgentChangeSetRollbackJobPayload[] = [];
  const verifyConvergence = vi.fn(() =>
    Promise.resolve({
      status: convergenceFails ? ("failed" as const) : ("passed" as const),
      evidenceRefs: [],
    }),
  );
  const options: NpAgentChangeSetServiceOptionsV1 = {
    cursorKey: new Uint8Array(32).fill(44),
    ...(rollbackWindowSeconds === undefined ? {} : { rollbackWindowSeconds }),
    now: () => time,
    secretRequestDigestKey: { id: "execution-request", key: new Uint8Array(32).fill(72) },
    reauthentication: {
      verify: () => ({ reauthenticatedAt: time.toISOString(), sessionFactFingerprint: digest }),
    },
    approvals: {
      integrityKeys: {
        active: {
          owner: "approval-integrity",
          id: "execution-a",
          bytes: new Uint8Array(32).fill(71),
        },
      },
      challengeKeys: { active: { id: "execution-challenge", key: new Uint8Array(32).fill(73) } },
      lifetimeSeconds: 600,
      resolveExecutionBinding: (input) => Promise.resolve(binding(input.intendedOperation)),
    },
    execution: {
      resolveIntent: () => Promise.resolve({ enabled: true, paused }),
      verificationFingerprint: digest,
      verifyConvergence,
      ...(inspectPostCommitEffect ? { inspectPostCommitEffect } : {}),
      enqueueApply: (job) => {
        applyJobs.push(job);
        return Promise.resolve();
      },
      ...(deferRollback
        ? {
            enqueueRollback: (job: NpAgentChangeSetRollbackJobPayload) => {
              rollbackJobs.push(job);
              return Promise.resolve();
            },
          }
        : {}),
      ...(deferVerification
        ? {
            enqueueVerify: (job: NpAgentChangeSetVerifyJobPayload) => {
              verifyJobs.push(job);
              return Promise.resolve();
            },
          }
        : {}),
    },
    preview: {
      ...configuration,
      storageAdapter: adapter,
      resolveAdapter: () => adapter,
      checks: {
        rendererId: configuration.contract.rendererId,
        rendererVersion: configuration.contract.rendererVersion,
        rendererFingerprint: configuration.contract.rendererFingerprint,
        productionOrigins: ["https://site.example"],
        resolveManifest: () =>
          Promise.resolve([{ route: "/", locale: null, audience: "public" as const }]),
        render: () =>
          Promise.resolve(
            '<html lang="en"><head><title>Review</title><meta name="description" content="Review"></head><body><main>Preview</main></body></html>',
          ),
      },
    },
  };
  const f = await fixture(options);
  const principal = principalExposure
    ? await principalFixture(
        f,
        false,
        options,
        ["changeset:apply", "content:publish", "settings:read", "settings:write"],
        principalExposure,
      )
    : null;
  const service = principal?.service ?? f.service;
  const creator = principal?.actor ?? f.actor;
  const value: NpAgentChangeSetDraftInputV1 = draftInput
    ? await draftInput(f)
    : document
      ? draft()
      : {
          title: "Apply SEO",
          summary: null,
          operations: [
            {
              kind: "setting",
              operation: "replace",
              clientOperationId: "seo",
              reason: null,
              resource: { key: "seo" },
              base: null,
              input: {
                value: { defaultOgImage: null, twitterHandle: "execution", defaultLocale: "en" },
              },
            },
          ],
        };
  const created = await service.create({ actor: creator, command: await command(value) });
  const sealed = await service.validate({
    actor: creator,
    id: created.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
  });
  const preview = await service.preview({
    actor: creator,
    id: created.id,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      expectedPlanHash: sealed.planHash,
    },
  });
  await service.processPreview({ siteId, previewId: preview.previewId });
  const requested = await service.requestApproval({
    actor: f.actor,
    id: created.id,
    command: {
      schemaVersion: "np.agent-changeset-request-approval-input.v1",
      expectedDraftVersion: 1,
      planHash: sealed.planHash,
      intendedOperation,
      scheduledFor,
      idempotencyKey: randomUUID(),
    },
  });
  let approver = f.actor;
  if (distinctApprover) {
    const seeded = await seedUser({ role: "admin" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const [user] = await f.db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.userId, seeded.userId));
    approver = {
      kind: "staff",
      siteId,
      actor: { user: { ...user, tokenVersion: user.tokenVersion }, sessionId: session.id },
    };
  }
  const approved = await decideApproval(service.approvals!, approver, requested);
  const executionCommand = {
    schemaVersion:
      intendedOperation === "apply"
        ? "np.agent-changeset-apply-input.v1"
        : "np.agent-changeset-schedule-input.v1",
    expectedDraftVersion: 1,
    planHash: sealed.planHash,
    approvalId: approved.item.approval.id,
    statementHash: approved.item.statementHash,
    idempotencyKey: randomUUID(),
    ...(scheduledFor ? { scheduledFor } : {}),
  };
  return {
    ...f,
    service,
    principal,
    approver,
    id: created.id,
    approved,
    executionCommand,
    applyJobs,
    verifyJobs,
    rollbackJobs,
    verifyConvergence,
    advance(seconds: number) {
      time = new Date(time.getTime() + seconds * 1000);
    },
    pause() {
      paused = true;
    },
    async seo() {
      return (
        await f.db
          .select()
          .from(npSettings)
          .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "seo")))
      )[0];
    },
    async execution() {
      return (
        await f.db
          .select()
          .from(npAgentChangesetExecutions)
          .where(
            and(
              eq(npAgentChangesetExecutions.changesetId, created.id),
              eq(npAgentChangesetExecutions.purpose, "apply"),
            ),
          )
      )[0];
    },
  };
}

export async function decideApproval(
  approvals: NpAgentApprovalServiceV1,
  approver: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>,
  requested: NpAgentApprovalDetailV1,
  decision: "approve" | "reject" | "revoke" = "approve",
) {
  const challenge = await approvals.issueChallenge({
    siteId,
    actor: approver.actor,
    id: requested.item.approval.id,
    command: {
      schemaVersion: "np.agent-approval-challenge-request.v1",
      purpose: decision,
      expectedApprovalVersion: requested.item.version,
      statementHash: requested.item.statementHash,
      idempotencyKey: randomUUID(),
    },
  });
  return approvals.decide({
    siteId,
    actor: approver.actor,
    id: requested.item.approval.id,
    decision,
    command: {
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: challenge.approvalVersion,
      statementHash: requested.item.statementHash,
      challengeGeneration: challenge.challengeGeneration,
      challenge: challenge.challenge,
      idempotencyKey: randomUUID(),
      reason: "Reviewed decision",
    },
  });
}
