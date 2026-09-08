import { randomUUID } from "node:crypto";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import {
  createSite,
  grantSiteMembership,
  createStaffSession,
  npUsers,
  npSessions,
  npRevisions,
  npAuditEvents,
} from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentChangeSetServiceV1,
  type NpAgentChangeSetActorV1,
  type NpAgentChangeSetServiceOptionsV1,
} from "../../../packages/core/src/agent/changeset-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
  type NpAgentChangeSetDraftInputV1,
} from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentInvocations,
  npAgentActions,
  npAgentPrincipals,
} from "../../../packages/core/src/db/schema/agent.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { postsTable } from "../src/db/generated/collections.js";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
} from "./harness.js";
const siteId = "changeset-draft";
const settings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "propose" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "disabled" as const,
};
function draft(title = "Proposed content"): NpAgentChangeSetDraftInputV1 {
  return {
    title,
    summary: null,
    operations: [
      {
        kind: "document",
        operation: "create",
        clientOperationId: "create-post",
        reason: null,
        resource: { collection: "posts", documentId: null },
        base: null,
        input: {
          document: {
            title: "Proposed post",
            content: npCreateEmptyRichTextContent(),
          },
          targetStatus: "draft",
        },
      },
    ],
  };
}
async function command(value = draft(), idempotencyKey = randomUUID(), expectedVersion?: number) {
  return {
    idempotencyKey,
    proposalJson: npBuildAgentChangeSetDraftInputJsonV1(value),
    proposalHash: await npDigestAgentChangeSetDraftInputV1(value),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}
async function fixture(options: Partial<NpAgentChangeSetServiceOptionsV1> = {}) {
  const db = await getTestDb();
  const seeded = await seedUser({ role: "admin" });
  await createSite({ id: siteId, name: "Draft site" });
  await createSite({ id: "draft-other", name: "Other" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  await grantSiteMembership("draft-other", seeded.userId, "admin");
  const [user] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId));
  const [session] = await db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId));
  const actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }> = {
    kind: "staff",
    siteId,
    actor: {
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        tokenVersion: user!.tokenVersion,
      },
      sessionId: session!.id,
    },
  };
  return {
    db,
    actor,
    service: createAgentChangeSetServiceV1({
      cursorKey: new Uint8Array(32).fill(44),
      reauthentication: { verify: () => true },
      ...options,
    }),
  };
}
async function principalFixture(f: Awaited<ReturnType<typeof fixture>>, writeOnly = false) {
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring: { active: { id: "draft-key", key: new Uint8Array(32).fill(25) } },
    environment: "production",
    deploymentGatewaySettings: settings,
    resolveSiteGatewaySettings: () => settings,
    reauthentication: { verify: () => true },
  });
  const scopes = writeOnly
    ? ["changeset:write", "content:draft", "site:read"]
    : ["changeset:read", "changeset:write", "content:draft", "content:read", "site:read"];
  const principal = await gateway.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.principals.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      name: "Draft client",
      description: null,
      scopes: [...scopes],
    },
  });
  const token = await gateway.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.principal_tokens.create",
    targetId: principal.resourceId,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      name: "Draft token",
      scopes: [...scopes],
      transport: "stdio",
      exposure: "propose",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  const authentication = await gateway.authenticateServiceToken({
    siteId,
    credential: token.oneTimeValue,
    transport: "stdio",
    audience: "urn:nexpress:agent-gateway:stdio",
  });
  const executors = createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey: { id: "draft-read-key", key: new Uint8Array(32).fill(26) },
    resolveBlockSchemas: () => [],
    resolveUser: () => f.actor.actor.user,
  });
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    resolveGatewaySettings: () => settings,
  });
  return {
    gateway,
    principal,
    authentication,
    service: createAgentChangeSetServiceV1({
      cursorKey: new Uint8Array(32).fill(44),
      admission,
      reauthentication: { verify: () => true },
    }),
    actor: { kind: "principal" as const, authentication },
  };
}
describe.skipIf(skipIfNoTestDb())("ChangeSet durable draft service", () => {
  beforeAll(ensureMigrated);
  beforeEach(registerTestCollections);
  afterEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("creates and replaces a draft with stable reserved IDs without writing content", async () => {
    const f = await fixture();
    const input = await command();
    const first = await f.service.create({ actor: f.actor, command: input });
    expect(first.state).toBe("draft");
    expect(first.draftVersion).toBe(1);
    expect(first.planHash).toBeNull();
    expect(first.approval).toBeNull();
    const reserved = first.operations[0]!.canonicalResourceKey;
    expect(reserved.kind).toBe("document");
    const replay = await f.service.create({ actor: f.actor, command: input });
    expect(replay.id).toBe(first.id);
    expect(replay.operations[0]!.canonicalResourceKey).toEqual(reserved);
    const second = await f.service.update({
      actor: f.actor,
      id: first.id,
      command: await command(draft("Revised proposal"), randomUUID(), 1),
    });
    expect(second.draftVersion).toBe(2);
    expect(second.draftHash).not.toBe(first.draftHash);
    expect(second.operations[0]!.canonicalResourceKey).toEqual(reserved);
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(await f.db.select().from(npRevisions)).toEqual([]);
    expect(await f.db.select().from(npAgentActions)).toEqual([]);
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);
    expect(await f.db.select().from(npAgentChangesetOperations)).toHaveLength(1);
    const evidence = await f.db.select().from(npAgentInvocations);
    expect(
      evidence
        .filter((row) => row.operationId.startsWith("agents.changesets."))
        .every((row) => row.state === "completed"),
    ).toBe(true);
  });
  it("replays creation across sessions and rejects conflicting payloads or stale CAS", async () => {
    const f = await fixture();
    const input = await command();
    const first = await f.service.create({ actor: f.actor, command: input });
    await createStaffSession(f.actor.actor.user, process.env.NP_SECRET as string, f.db, {
      accessExpiration: 3600,
      refreshExpiration: 86400,
    });
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(
        and(
          eq(npSessions.userId, f.actor.actor.user.id),
          ne(npSessions.id, f.actor.actor.sessionId),
        ),
      );
    const actor = { ...f.actor, actor: { ...f.actor.actor, sessionId: session!.id } };
    expect((await f.service.create({ actor, command: input })).id).toBe(first.id);
    await expect(
      f.service.create({
        actor,
        command: await command(draft("Different payload"), input.idempotencyKey),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.service.update({
      actor,
      id: first.id,
      command: await command(draft("Updated"), randomUUID(), 1),
    });
    await expect(
      f.service.update({
        actor,
        id: first.id,
        command: await command(draft("Stale update"), randomUUID(), 1),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);
  });
  it("does not reveal cross-site or currently hidden target drafts", async () => {
    const f = await fixture();
    const first = await f.service.create({ actor: f.actor, command: await command() });
    await expect(
      f.service.get({ actor: { ...f.actor, siteId: "draft-other" }, id: first.id }),
    ).rejects.toMatchObject({ status: 404, code: "CHANGESET_NOT_FOUND" });
    expect((await f.service.list({ actor: { ...f.actor, siteId: "draft-other" } })).items).toEqual(
      [],
    );
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { ...original.access, read: () => false },
    });
    await expect(f.service.get({ actor: f.actor, id: first.id })).rejects.toMatchObject({
      status: 404,
    });
    expect((await f.service.list({ actor: f.actor })).items).toEqual([]);
    await expect(
      f.service.update({
        actor: f.actor,
        id: first.id,
        command: await command(draft("Hidden update"), randomUUID(), 1),
      }),
    ).rejects.toThrow();
  });
  it("closes concurrent duplicate creates and allows only one current-version update", async () => {
    const f = await fixture();
    const input = await command();
    const results = await Promise.allSettled([
      f.service.create({ actor: f.actor, command: input }),
      f.service.create({ actor: f.actor, command: input }),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const created = results.map(
      (result) =>
        (result as PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.create>>>).value,
    );
    expect(created[0]!.id).toBe(created[1]!.id);
    const outcomes = await Promise.allSettled([
      f.service.update({
        actor: f.actor,
        id: created[0]!.id,
        command: await command(draft("A"), randomUUID(), 1),
      }),
      f.service.update({
        actor: f.actor,
        id: created[0]!.id,
        command: await command(draft("B"), randomUUID(), 1),
      }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await f.db.select().from(npAgentChangesets))[0]?.draftVersion).toBe(2);
  });
  it("admits propose principals through existing authority and blocks revocation or missing scopes", async () => {
    const f = await fixture();
    const p = await principalFixture(f);
    const input = await command();
    const first = await p.service.create({ actor: p.actor, command: input });
    expect(first.actor.kind).toBe("external");
    expect(first.actor.id).toBe(p.principal.resourceId);
    expect((await p.service.create({ actor: p.actor, command: input })).id).toBe(first.id);
    await expect(
      p.service.create({
        actor: {
          kind: "principal",
          authentication: { ...p.authentication, scopes: ["site:read"] },
        },
        command: await command(),
      }),
    ).rejects.toThrow();
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended", tokenVersion: 2 })
      .where(eq(npAgentPrincipals.id, p.principal.resourceId));
    await expect(p.service.get({ actor: p.actor, id: first.id })).rejects.toThrow();
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(
      (await f.db.select().from(npAuditEvents)).some(
        (row) => row.action === "agents.changesets.create",
      ),
    ).toBe(true);
  });
  it("permits a proposal-only principal to create without granting draft read authority", async () => {
    const f = await fixture();
    const p = await principalFixture(f, true);
    const created = await p.service.create({ actor: p.actor, command: await command() });
    expect(created.state).toBe("draft");
    await expect(p.service.get({ actor: p.actor, id: created.id })).rejects.toThrow();
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
  it("rechecks expiry after a row-lock wait and reconciles without applying content", async () => {
    let clock = new Date();
    const f = await fixture({ now: () => clock, eligibilitySeconds: 60 });
    const created = await f.service.create({ actor: f.actor, command: await command() });
    let markLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      markLocked = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, created.id))
        .for("update");
      const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      markLocked(backend.rows[0]!.pid);
      await released;
    });
    const holderPid = await locked;
    const update = f.service.update({
      actor: f.actor,
      id: created.id,
      command: await command(draft("Expired"), randomUUID(), 1),
    });
    const completion = Promise.allSettled([update]);
    try {
      await expect
        .poll(
          async () => {
            const result = await f.db.execute<{ waiting: boolean }>(
              sql`select exists (select 1 from pg_stat_activity where ${holderPid} = any(pg_blocking_pids(pid))) as waiting`,
            );
            return result.rows[0]?.waiting;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      clock = new Date(clock.getTime() + 61_000);
    } finally {
      release();
      await holder;
      await completion;
    }
    expect((await completion)[0]).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const [row] = await f.db
      .select()
      .from(npAgentChangesets)
      .where(eq(npAgentChangesets.id, created.id));
    expect(row!.draftVersion).toBe(1);
    await f.service.reconcileExpired({ siteId });
    const [expired] = await f.db
      .select()
      .from(npAgentChangesets)
      .where(eq(npAgentChangesets.id, created.id));
    expect(expired!.state).toBe("cancelled");
    expect(await f.db.select().from(postsTable)).toEqual([]);
  });
});
