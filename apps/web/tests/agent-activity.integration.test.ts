// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { postsTable } from "../src/db/generated/collections.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, afterEach, afterAll, describe, it, expect } from "vitest";
import {
  createSite,
  grantSiteMembership,
  npUsers,
  npSessions,
  npAgentRuns,
  npAgentActions,
  npAgentInvocations,
  npSiteMemberships,
  npAgentPrincipals,
} from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentGatewayServiceV1,
  createAgentReadCapabilityRegistryV1,
  createAgentCapabilityAdmissionServiceV1,
  type NpAgentReadCapabilityExecutorsV1,
} from "../../../packages/core/src/agent/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
} from "./harness.js";
const siteId = "agent-activity";
const gatewaySettings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "read" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "read" as const,
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

async function fixture(transport: "stdio" | "agent-http" = "stdio") {
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
    resolveCanonicalSiteOrigin: () => "https://activity.example.test",
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
      transport,
      exposure: "read",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    },
  });
  const authentication = await gateway.authenticateServiceToken({
    siteId,
    credential: token.oneTimeValue,
    transport,
    audience:
      transport === "stdio"
        ? "urn:nexpress:agent-gateway:stdio"
        : "https://activity.example.test/api/agent/v1",
  });
  const registry = await createAgentReadCapabilityRegistryV1(executors());
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveGatewaySettings: () => gatewaySettings,
  });
  let clock = new Date();
  const activity = createAgentActivityServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(41),
    admission,
    now: () => clock,
  });
  return {
    actor,
    db,
    principal,
    gateway,
    authentication,
    admission,
    activity,
    advance: (ms = 86_400_000) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}
async function seedRun(f: Awaited<ReturnType<typeof fixture>>) {
  const [inv] = await f.db
    .select()
    .from(npAgentInvocations)
    .where(eq(npAgentInvocations.operationId, "site.inspect"));
  const id = randomUUID();
  const queuedAt = new Date();
  await f.db.insert(npAgentRuns).values({
    id,
    siteId,
    origin: "gateway",
    principalId: f.principal.resourceId,
    invocationId: inv!.id,
    admissionFingerprint: schemaDigest,
    rootRunId: id,
    parentRunId: null,
    causalDepth: 0,
    state: "succeeded",
    goal: "PRIVATE PROMPT",
    policyRefs: [],
    runLimits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 1,
      maxProviderCalls: 1,
      maxCapabilityCalls: 1,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxCostMicros: 1,
      maxWallClockSeconds: 60,
    },
    runLimitsHash: schemaDigest,
    budgetSnapshot: {},
    budgetSnapshotHash: schemaDigest,
    idempotencyKey: "activity-run",
    attempt: 1,
    usage: { providerCalls: 0, capabilityCalls: 1 },
    queuedAt,
    deadlineAt: new Date(queuedAt.getTime() + 60000),
    startedAt: queuedAt,
    finishedAt: queuedAt,
  });
  return id;
}
describe.skipIf(skipIfNoTestDb())("Agent Activity", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(async () => {
    await closeTestDb();
  });
  it("projects bounded inline evidence without raw input/output and applies collection visibility", async () => {
    const f = await fixture();
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const [stored] = await f.db.select().from(npAgentActions);
    const page = await f.activity.listActions({ siteId, actor: f.actor });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.action.outputRedacted).toEqual({});
    expect(JSON.stringify(page)).not.toContain("Capability site");
    expect((await f.activity.getAction({ siteId, actor: f.actor, id: stored!.id })).evidence).toBe(
      "redacted",
    );
    await f.db
      .update(npAgentActions)
      .set({ inputCanonical: { collection: "posts" }, capabilityId: "content.query" })
      .where(eq(npAgentActions.id, stored!.id));
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    expect((await f.activity.listActions({ siteId, actor: f.actor })).items).toEqual([]);
    await expect(
      f.activity.getAction({ siteId, actor: f.actor, id: stored!.id }),
    ).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    registerCollection("posts", getCollectionTable("posts"), original);
    await f.db.update(npAgentInvocations).set({ expiresAt: new Date(Date.now() + 1_000) });
    f.advance(2_000);
    expect((await f.activity.getAction({ siteId, actor: f.actor, id: stored!.id })).evidence).toBe(
      "expired",
    );
  });
  it("binds keyset cursors to actor/filter/site and rejects stale staff authority", async () => {
    const f = await fixture();
    const first = await f.activity.listPrincipals({ siteId, actor: f.actor, query: { limit: 1 } });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    expect(
      Buffer.from(first.nextCursor!.split(".")[0]!, "base64url").toString("utf8"),
    ).not.toContain(f.principal.resourceId);
    const second = await f.activity.listPrincipals({
      siteId,
      actor: f.actor,
      query: { limit: 1, cursor: first.nextCursor },
    });
    expect(second.items).toEqual([]);
    for (const query of [
      { limit: 1, cursor: first.nextCursor + "x" },
      { limit: 2, cursor: first.nextCursor },
    ])
      await expect(
        f.activity.listPrincipals({ siteId, actor: f.actor, query }),
      ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
    await createSite({ id: "activity-other", name: "Other" });
    await grantSiteMembership("activity-other", f.actor.user.id, "admin");
    await expect(
      f.activity.getPrincipal({
        siteId: "activity-other",
        actor: f.actor,
        id: f.principal.resourceId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.activity.listPrincipals({
        siteId: "activity-other",
        actor: f.actor,
        query: { limit: 1, cursor: first.nextCursor },
      }),
    ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(eq(npSiteMemberships.userId, f.actor.user.id));
    await expect(f.activity.listPrincipals({ siteId, actor: f.actor })).rejects.toMatchObject({
      status: 403,
    });
  });
  it("renders gateway runs honestly and gives identical machine errors for absent/cross-transport runs", async () => {
    const f = await fixture();
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const id = await seedRun(f);
    const detail = await f.activity.getRun({ siteId, actor: f.actor, id });
    expect(detail.run.agent).toBeNull();
    expect(detail.run.origin).toBe("gateway");
    expect(JSON.stringify(detail)).not.toContain("PRIVATE PROMPT");
    expect(
      (
        await f.activity.listRuns({
          siteId,
          actor: f.actor,
          query: { capabilityId: "site.inspect" },
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (await f.activity.listRuns({ siteId, actor: f.actor, query: { origin: "runtime" } })).items,
    ).toEqual([]);
    for (const runId of [id, randomUUID()])
      await expect(
        f.activity.getMachineRun({ authentication: f.authentication, runId }),
      ).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    await f.db
      .update(npUsers)
      .set({ tokenVersion: f.actor.user.tokenVersion + 1 })
      .where(eq(npUsers.id, f.actor.user.id));
    await expect(f.activity.getRun({ siteId, actor: f.actor, id })).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rechecks machine site/principal/audience/scope and principal revocation", async () => {
    const f = await fixture("agent-http");
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const runId = await seedRun(f);
    expect(
      (await f.activity.getMachineRun({ authentication: f.authentication, runId })).run.id,
    ).toBe(runId);
    await expect(
      f.activity.getMachineRun({ authentication: { ...f.authentication, scopes: [] }, runId }),
    ).rejects.toMatchObject({ status: 404 });
    const authorityRef = f.authentication.authorizationContext.authorityRef;
    if (authorityRef.kind !== "service-family") throw new Error("fixture authority");
    await expect(
      f.activity.getMachineRun({
        authentication: {
          ...f.authentication,
          authorizationContext: {
            ...f.authentication.authorizationContext,
            authorityRef: { ...authorityRef, audience: "https://other.example.test/api/agent/v1" },
          },
        },
        runId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended", tokenVersion: 2 })
      .where(eq(npAgentPrincipals.id, f.principal.resourceId));
    await expect(
      f.activity.getMachineRun({ authentication: f.authentication, runId }),
    ).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND", status: 404 });
  });
  it("checks each document target against current collection access and site ownership", async () => {
    const f = await fixture();
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const [action] = await f.db.select().from(npAgentActions);
    const [doc] = await f.db
      .insert(postsTable)
      .values({
        siteId,
        title: "Target",
        slug: "activity-target",
        content: npCreateEmptyRichTextContent(),
        status: "published",
      })
      .returning({ id: postsTable.id });
    await f.db
      .update(npAgentActions)
      .set({ targetRefs: [{ kind: "document", collection: "posts", documentId: doc!.id }] })
      .where(eq(npAgentActions.id, action!.id));
    expect(
      (await f.activity.getAction({ siteId, actor: f.actor, id: action!.id })).action.targetRefs,
    ).toHaveLength(1);
    await createSite({ id: "activity-document-other", name: "Other" });
    await f.db
      .update(postsTable)
      .set({ siteId: "activity-document-other" })
      .where(eq(postsTable.id, doc!.id));
    await expect(
      f.activity.getAction({ siteId, actor: f.actor, id: action!.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await f.activity.listActions({ siteId, actor: f.actor })).items).toEqual([]);
    await f.db.update(postsTable).set({ siteId }).where(eq(postsTable.id, doc!.id));
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    await expect(
      f.activity.getAction({ siteId, actor: f.actor, id: action!.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("inspects runs beyond one page and fails closed if persisted actions exceed frozen limits", async () => {
    const f = await fixture();
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const runId = await seedRun(f);
    const [action] = await f.db.select().from(npAgentActions);
    const [run] = await f.db.select().from(npAgentRuns);
    await f.db
      .update(npAgentRuns)
      .set({ runLimits: { ...run!.runLimits, maxCapabilityCalls: 101 } })
      .where(eq(npAgentRuns.id, runId));
    await f.db
      .insert(npAgentActions)
      .values(
        Array.from({ length: 100 }, (_, i) => ({ ...action!, id: randomUUID(), sequence: i + 2 })),
      );
    expect((await f.activity.getRun({ siteId, actor: f.actor, id: runId })).run.id).toBe(runId);
    await f.db
      .update(npAgentRuns)
      .set({ runLimits: { ...run!.runLimits, maxCapabilityCalls: 100 } })
      .where(eq(npAgentRuns.id, runId));
    await expect(f.activity.getRun({ siteId, actor: f.actor, id: runId })).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects staff authority changing during visibility checks even when admin.manage remains", async () => {
    const f = await fixture();
    await f.admission.invoke({
      authentication: f.authentication,
      request: {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "site.inspect",
        arguments: { input: {}, idempotencyKey: null },
      },
    });
    const [action] = await f.db.select().from(npAgentActions);
    await f.db
      .update(npAgentActions)
      .set({ capabilityId: "content.query", inputCanonical: { collection: "posts" } })
      .where(eq(npAgentActions.id, action!.id));
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: {
        ...original.access,
        read: async () => {
          await f.db
            .update(npUsers)
            .set({ isSuperAdmin: false })
            .where(eq(npUsers.id, f.actor.user.id));
          return true;
        },
      },
    });
    for (const detail of [true, false]) {
      await f.db.update(npUsers).set({ isSuperAdmin: true }).where(eq(npUsers.id, f.actor.user.id));
      await expect(
        detail
          ? f.activity.getAction({ siteId, actor: f.actor, id: action!.id })
          : f.activity.listActions({ siteId, actor: f.actor }),
      ).rejects.toMatchObject({ status: 403 });
    }
  });
});
