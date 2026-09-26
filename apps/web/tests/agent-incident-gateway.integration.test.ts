import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentIncidents,
  npAgentServiceTokens,
  npAgentActions,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { fixture, principalFixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Incident Gateway admission", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("requires installation, current scopes and live credentials before emitting bounded read evidence", async () => {
    const f = await fixture();
    const principal = await principalFixture(f, false, {}, ["incident:read"]);
    const withoutScope = await principalFixture(f);
    const now = new Date();
    const [incident] = await f.db
      .insert(npAgentIncidents)
      .values({
        siteId,
        category: "availability",
        status: "open",
        severity: "medium",
        fingerprint: randomUUID(),
        title: "Synthetic worker lag",
        summary: "Bounded observation.",
        firstObservedAt: now,
        lastObservedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const owner = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(61),
      canReadIncident: () => true,
    });
    const base = {
      cursorHmacKey: { id: "incident-test", key: new Uint8Array(32).fill(62) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
    };
    const disabled = createAgentCapabilityAdmissionServiceV1({
      registry: await createAgentReadCapabilityRegistryV1(
        createAgentCoreReadCapabilityExecutorsV1(base),
      ),
      resolveGatewaySettings: () => principal.gatewaySettings,
    });
    const admission = createAgentCapabilityAdmissionServiceV1({
      registry: await createAgentReadCapabilityRegistryV1(
        createAgentCoreReadCapabilityExecutorsV1({ ...base, incidentService: owner }),
      ),
      resolveGatewaySettings: () => principal.gatewaySettings,
    });
    const request = {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "incident.get" as const,
      arguments: { input: { incidentId: incident.id }, idempotencyKey: null },
    };
    expect(
      (await disabled.project({ authentication: principal.authentication })).entries.map(
        (entry) => entry.definition.descriptor.id,
      ),
    ).not.toContain("incident.get");
    await expect(
      disabled.invoke({ authentication: principal.authentication, request }),
    ).rejects.toThrow();
    expect(
      (await admission.project({ authentication: withoutScope.authentication })).entries.map(
        (entry) => entry.definition.descriptor.id,
      ),
    ).not.toContain("incident.get");
    await expect(
      admission.invoke({ authentication: withoutScope.authentication, request }),
    ).rejects.toThrow();
    const result = await admission.invoke({ authentication: principal.authentication, request });
    expect(result.output).toMatchObject({
      schemaVersion: "np.agent-incident-result.v1",
      incident: { id: incident.id, signalIds: [] },
    });
    expect(JSON.stringify(result.output)).not.toContain("evidenceJson");
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.siteId, siteId));
    expect(action).toMatchObject({
      state: "succeeded",
      capabilityId: "incident.get",
      requiredScopes: ["incident:read"],
      outputRedacted: result.output,
    });
    await f.db
      .update(npAgentServiceTokens)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(npAgentServiceTokens.id, principal.authentication.serviceToken.id));
    await expect(
      admission.invoke({ authentication: principal.authentication, request }),
    ).rejects.toThrow();
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.siteId, siteId)),
    ).toHaveLength(1);
  });
});
