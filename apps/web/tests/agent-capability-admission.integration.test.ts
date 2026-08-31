import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSite,
  deleteSite,
  getSiteById,
  grantSiteMembership,
  npAgentActions,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentRuns,
  npAuditEvents,
  npSessions,
  npSiteMemberships,
  npUsers,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentCapabilityAdmissionServiceV1,
  createAgentGatewayServiceV1,
  createAgentReadCapabilityRegistryV1,
  type NpAgentReadCapabilityExecutorsV1,
} from "../../../packages/core/src/agent/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npDigestAgentAuthorizationContextCanonical } from "../../../packages/core/src/agent-contract/index.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "agent-capability";
const gatewaySettings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "read" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "disabled" as const,
};
const schemaDigest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function executors(failSiteInspect = false): NpAgentReadCapabilityExecutorsV1 {
  return {
    "site.inspect": async () => {
      if (failSiteInspect) throw new Error("provider-secret-sk-live-must-not-leak");
      return {
        schemaVersion: "np.agent-site-inspect.v1",
        site: { id: siteId, name: "Capability site", defaultLocale: "en", locales: ["en"] },
        features: { remoteMcp: false, agentHttp: false, runtime: "ready" },
        counts: { collections: 0, blocks: 0, activePlugins: 0 },
        resourceUris: [],
      };
    },
    "schema.get": async (input) => ({
      schemaVersion: "np.agent-schema-resource.v1",
      selector: input,
      digest: schemaDigest,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    }),
    "content.query": async (input) => ({
      schemaVersion: "np.agent-content-query.v1",
      collection: input.collection,
      items: [],
      nextCursor: null,
    }),
  };
}

describe.skipIf(skipIfNoTestDb())("Agent capability admission", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("persists exact inline read evidence and fails closed on scope, execution, and authority loss", async () => {
    const seeded = await seedUser({ role: "admin" });
    await createSite({ id: siteId, name: "Capability site" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const db = await getTestDb();
    const [[user], [session]] = await Promise.all([
      db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1),
      db
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(eq(npSessions.userId, seeded.userId))
        .limit(1),
    ]);
    expect(user).toBeDefined();
    expect(session).toBeDefined();
    const actor = {
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        tokenVersion: user!.tokenVersion,
      },
      sessionId: session!.id,
    };
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(19) },
      },
      environment: "production",
      deploymentGatewaySettings: gatewaySettings,
      resolveSiteGatewaySettings: () => gatewaySettings,
      reauthentication: { verify: () => true },
    });
    const principal = await gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principals.create",
      targetId: null,
      command: {
        idempotencyKey: "agent:capability:principal",
        name: "Capability automation",
        description: null,
        scopes: ["content:read", "site:read"],
      },
    });
    const token = await gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.create",
      targetId: principal.resourceId,
      command: {
        idempotencyKey: "agent:capability:token",
        expectedVersion: 1,
        name: "Capability stdio",
        scopes: ["content:read", "site:read"],
        transport: "stdio",
        exposure: "read",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
    const authentication = await gateway.authenticateServiceToken({
      siteId,
      credential: token.oneTimeValue,
      transport: "stdio",
      audience: "urn:nexpress:agent-gateway:stdio",
    });
    const registry = await createAgentReadCapabilityRegistryV1(executors());
    const admission = createAgentCapabilityAdmissionServiceV1({
      registry,
      resolveGatewaySettings: () => gatewaySettings,
    });
    const request = {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "site.inspect" as const,
      arguments: { input: {}, idempotencyKey: null },
    };
    const tamperedAuthorizationContext = {
      ...authentication.authorizationContext,
      actor: {
        ...authentication.authorizationContext.actor,
        actorFingerprint: schemaDigest,
      },
    };
    await expect(
      admission.invoke({
        authentication: {
          ...authentication,
          authorizationContext: tamperedAuthorizationContext,
          authorizationContextFingerprint: await npDigestAgentAuthorizationContextCanonical(
            tamperedAuthorizationContext,
          ),
        },
        request,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CHANGED", status: 409 });
    await expect(admission.invoke({ authentication, request })).resolves.toMatchObject({
      schemaVersion: "np.agent-read-invocation-result.v1",
      capabilityId: "site.inspect",
      output: { schemaVersion: "np.agent-site-inspect.v1" },
    });

    const [succeeded] = await db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.siteId, siteId));
    expect(succeeded).toMatchObject({
      state: "succeeded",
      runId: null,
      requiredScopes: ["site:read"],
      capabilityDefinitionBody: {
        projection: "definition",
        capabilities: [{ descriptor: { id: "site.inspect" } }],
      },
    });
    await expect(
      db
        .update(npAgentActions)
        .set({ verificationEvidence: [{}] })
        .where(eq(npAgentActions.id, succeeded!.id)),
    ).rejects.toThrow();

    await expect(
      admission.invoke({
        authentication,
        request: {
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId: "content.query",
          arguments: {
            input: {
              collection: "posts",
              filter: null,
              fields: [],
              audience: "public",
              status: "any",
              sort: [],
              limit: 10,
              cursor: null,
            },
            idempotencyKey: null,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE", status: 403 });

    const failingRegistry = await createAgentReadCapabilityRegistryV1(executors(true));
    const failingAdmission = createAgentCapabilityAdmissionServiceV1({
      registry: failingRegistry,
      resolveGatewaySettings: () => gatewaySettings,
    });
    await expect(failingAdmission.invoke({ authentication, request })).rejects.toMatchObject({
      code: "CAPABILITY_EXECUTION_FAILED",
      status: 500,
      message: "Capability execution failed.",
    });

    await db
      .delete(npSiteMemberships)
      .where(
        and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, seeded.userId)),
      );
    await expect(admission.invoke({ authentication, request })).rejects.toMatchObject({
      code: "AUTHORIZATION_CHANGED",
      status: 409,
    });

    const [actions, invocations, audits, principals] = await Promise.all([
      db.select().from(npAgentActions).where(eq(npAgentActions.siteId, siteId)),
      db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, siteId),
            eq(npAgentInvocations.operationKind, "capability"),
          ),
        ),
      db.select().from(npAuditEvents).where(eq(npAuditEvents.siteId, siteId)),
      db.select().from(npAgentPrincipals).where(eq(npAgentPrincipals.siteId, siteId)),
    ]);
    expect(actions.map((row) => row.state).sort()).toEqual(["failed", "succeeded"]);
    expect(invocations.map((row) => row.state).sort()).toEqual(["completed", "failed"]);
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "agents.capability.invoke",
        "agents.capability.complete",
        "agents.capability.fail",
      ]),
    );
    expect(principals).toHaveLength(1);
    const evidence = JSON.stringify({ actions, invocations, audits });
    expect(evidence).not.toContain(token.oneTimeValue);
    expect(evidence).not.toContain("provider-secret-sk-live-must-not-leak");

    const completedInvocation = invocations.find((row) => row.state === "completed");
    expect(completedInvocation).toBeDefined();
    const runId = randomUUID();
    const queuedAt = new Date();
    await db.insert(npAgentRuns).values({
      id: runId,
      siteId,
      origin: "gateway",
      principalId: principal.resourceId,
      invocationId: completedInvocation!.id,
      admissionFingerprint: "cj1:sha256:gateway-run-fixture",
      rootRunId: runId,
      parentRunId: null,
      causalDepth: 0,
      state: "succeeded",
      goal: "Exercise generalized Gateway run deletion",
      policyRefs: [],
      runLimits: {
        schemaVersion: "np.agent-run-limits.v1",
        maxAttempts: 1,
        maxProviderCalls: 0,
        maxCapabilityCalls: 1,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        maxCostMicros: 0,
        maxWallClockSeconds: 60,
      },
      runLimitsHash: "cj1:sha256:gateway-run-limits",
      budgetSnapshot: {},
      budgetSnapshotHash: "cj1:sha256:gateway-budget-snapshot",
      idempotencyKey: "agent:capability:durable-fixture",
      attempt: 1,
      usage: { providerCalls: 0, capabilityCalls: 1 },
      queuedAt,
      deadlineAt: new Date(queuedAt.getTime() + 60_000),
      startedAt: queuedAt,
      finishedAt: queuedAt,
    });
    await expect(
      db
        .update(npAgentRuns)
        .set({ providerRequestId: "provider-call-must-not-exist" })
        .where(eq(npAgentRuns.id, runId)),
    ).rejects.toThrow();
    await deleteSite(siteId, { cascade: true });
    expect(await getSiteById(siteId)).toBeNull();
  });
});
