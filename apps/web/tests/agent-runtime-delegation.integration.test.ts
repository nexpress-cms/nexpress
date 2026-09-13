import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { createAgentCoreRuntimeDocumentEvidenceReaderV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import { runtimeFixture, runtimeDefinition, siteId } from "./agent-runtime-service-fixture.js";
import {
  npAgents,
  npAgentPrincipals,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { npUsers } from "../../../packages/core/src/db/schema/system.js";
import { npBuildAgentRuntimeDefinitionInputV1 } from "../../../packages/core/src/agent/runtime-service.js";
import { npRuntimeRunAdmissionBodyV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { npDigestAgentRunAdmissionCanonical } from "../../../packages/core/src/agent-contract/canonical-run-admission.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
import {
  grantSiteMembership,
  revokeSiteMembership,
} from "../../../packages/core/src/sites/memberships.js";

async function delegated() {
  const f = await runtimeFixture(undefined, true, { delegated: true });
  const { runId } = await f.admission.admit(f.runInput);
  const context = await f.admission.withCurrentRun({ siteId, runId }, async (value) => value);
  return { ...f, runId, principalId: context.evidence.principal.id };
}
describe.skipIf(skipIfNoTestDb())("Explicit Runtime staff delegation", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("requires an explicit self selection and freezes current real staff authority in the Run", async () => {
    const f = await delegated();
    await f.admission.withCurrentRun({ siteId, runId: f.runId }, async (context) => {
      expect(context.staffUser?.id).toBe(f.actor.actor.user.id);
      expect(context.evidence.principal.authorityKind).toBe("user");
      expect(context.evidence.principal.authorityPolicyId).toBeNull();
      const body = npRuntimeRunAdmissionBodyV1(context.run);
      expect(body.runtimeAuthority?.principalTokenVersion).toBe(
        context.evidence.principal.tokenVersion,
      );
      expect(body.runtimeAuthority?.staffAuthorizationFingerprint).toMatch(/^cj1:sha256:/);
      expect(await npDigestAgentRunAdmissionCanonical(body)).toBe(context.run.admissionFingerprint);
    });
  });

  it("preserves deployment authority when the selection is omitted", async () => {
    const f = await runtimeFixture();
    const { runId } = await f.admission.admit(f.runInput);
    await f.admission.withCurrentRun({ siteId, runId }, async (context) => {
      expect(context.staffUser).toBeNull();
      expect(context.evidence.principal.authorityKind).toBe("deployment");
      expect(
        npRuntimeRunAdmissionBodyV1(context.run).runtimeAuthority?.staffAuthorizationFingerprint,
      ).toBeNull();
    });
  });

  it("rejects another staff identity and cannot rebind an existing Agent", async () => {
    const f = await delegated();
    const before = await f.db.select({ id: npAgents.id }).from(npAgents);
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.configurations.create",
        targetId: null,
        command: {
          idempotencyKey: randomUUID(),
          ...npBuildAgentRuntimeDefinitionInputV1(runtimeDefinition()),
          authority: { kind: "user", userId: randomUUID() },
        },
      }),
    ).rejects.toThrow();
    expect(await f.db.select({ id: npAgents.id }).from(npAgents)).toEqual(before);
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.configurations.update",
        targetId: f.created.resourceId,
        command: {
          expectedVersion: f.current.output.rowVersion,
          configHash: f.current.output.configHash,
          idempotencyKey: randomUUID(),
          ...npBuildAgentRuntimeDefinitionInputV1(runtimeDefinition()),
          authority: { kind: "user", userId: f.actor.actor.user.id },
        },
      }),
    ).rejects.toThrow();
  });

  it.each(["principal", "staff"] as const)(
    "invalidates old Run and admission replay after %s token-version changes",
    async (kind) => {
      const f = await delegated();
      if (kind === "principal")
        await f.db
          .update(npAgentPrincipals)
          .set({ tokenVersion: sql`${npAgentPrincipals.tokenVersion} + 1` })
          .where(eq(npAgentPrincipals.id, f.principalId));
      else
        await f.db
          .update(npUsers)
          .set({ tokenVersion: sql`${npUsers.tokenVersion} + 1` })
          .where(eq(npUsers.id, f.actor.actor.user.id));
      await expect(
        f.admission.withCurrentRun({ siteId, runId: f.runId }, async () => true),
      ).rejects.toThrow();
      await expect(f.admission.admit(f.runInput)).rejects.toThrow();
    },
  );

  it("does not revive an old Run when membership is removed and restored", async () => {
    const f = await delegated();
    await revokeSiteMembership(siteId, f.actor.actor.user.id);
    await grantSiteMembership(siteId, f.actor.actor.user.id, "admin");
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, async () => true),
    ).rejects.toThrow();
    const fresh = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    expect(fresh.runId).not.toBe(f.runId);
  });

  it("rejects altered or legacy authority evidence for a delegated Run", async () => {
    const f = await delegated();
    const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId));
    const sources = structuredClone(run.runtimeAdmissionSources!);
    delete sources.runtimeAuthority;
    const legacy = { ...run, runtimeAdmissionSources: sources };
    await f.db
      .update(npAgentRuns)
      .set({
        runtimeAdmissionSources: sources,
        admissionFingerprint: await npDigestAgentRunAdmissionCanonical(
          npRuntimeRunAdmissionBodyV1(legacy),
        ),
      })
      .where(eq(npAgentRuns.id, run.id));
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, async () => true),
    ).rejects.toThrow();
  });

  it("uses existing authority-loss containment for Runtime users before deletion", async () => {
    const f = await delegated();
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: { active: { id: "delegation-test", key: new Uint8Array(32).fill(61) } },
      environment: "production",
      resolveCanonicalSiteOrigin: () => "https://site.example",
      reauthentication: { verify: () => true },
    });
    const result = await gateway.containUserAuthorityLoss(f.actor.actor.user.id);
    expect(result.principalIds).toContain(f.principalId);
    const [principal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, f.principalId));
    expect(principal.authorityUserId).toBeNull();
    expect(principal.authorityDeletedAt).not.toBeNull();
    expect(principal.status).toBe("suspended");
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, async () => true),
    ).rejects.toThrow();
  });
});

describe.skipIf(skipIfNoTestDb())("Delegated Runtime framework item reads", () => {
  const fixtures: Awaited<ReturnType<typeof runtimeUsageFixture>>[] = [];
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.dispose();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  const reader = () =>
    createAgentCoreRuntimeDocumentEvidenceReaderV1({
      cursorHmacKey: { id: "delegated-evidence", key: new Uint8Array(32).fill(12) },
      resolveUser: () => {
        throw new Error("Runtime must use admitted staff identity");
      },
      resolveBlockSchemas: () => [],
    });

  it("reads a private draft through actual delegated authority and excludes current hidden fields from evidence and schema", async () => {
    const definition = runtimeDefinition();
    definition.scopes = ["content:draft", "content:read", "schema:read", "site:read"];
    definition.capabilityModes = [
      { capabilityId: "content.query", mode: "observe" },
      { capabilityId: "schema.get", mode: "observe" },
      { capabilityId: "site.inspect", mode: "observe" },
    ];
    const f = await runtimeUsageFixture({
      delegated: true,
      documentCollection: "posts",
      definition,
    });
    fixtures.push(f);
    const saved = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Hidden delegated title", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const id = String(saved.doc.id);
    await f.db.update(postsTable).set({ visibility: "private" }).where(eq(postsTable.id, id));
    const config = getCollectionConfig("posts");
    registerCollection("posts", postsTable, {
      ...config,
      fields: config.fields.map((field) =>
        "name" in field && field.name === "title" ? { ...field, hidden: true } : field,
      ),
    });
    const evidence = reader();
    const request = {
      kind: "document" as const,
      collection: "posts",
      documentId: id,
      projection: "bounded-text" as const,
    };
    const output = await f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
      evidence.read(current, request),
    );
    expect(output).toMatchObject({ items: [{ id, status: "draft" }] });
    expect(JSON.stringify(output)).not.toContain("Hidden delegated title");
    const schema = await f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
      evidence.read(current, { ...request, projection: "schema" }),
    );
    expect(schema).toHaveProperty("schema");
    expect(JSON.stringify(schema)).not.toContain('"title":');
    registerCollection("posts", postsTable, { ...config, access: { read: () => false } });
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
        evidence.read(current, request),
      ),
    ).rejects.toThrow();
  });

  it("does not let staff identity substitute for the absent draft scope", async () => {
    const f = await runtimeUsageFixture({ delegated: true, documentCollection: "posts" });
    fixtures.push(f);
    const saved = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Draft without scope", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "draft" },
      ),
    );
    const evidence = reader();
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
        evidence.read(current, {
          kind: "document",
          collection: "posts",
          documentId: String(saved.doc.id),
          projection: "bounded-text",
        }),
      ),
    ).rejects.toThrow();
  });

  it("preserves public-only deployment reads and rejects private, schema and cross-site access", async () => {
    const f = await runtimeUsageFixture({ documentCollection: "posts" });
    fixtures.push(f);
    const saved = await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Public deployment article", content: npCreateEmptyRichTextContent() },
        f.actor.actor.user,
        { status: "published" },
      ),
    );
    const id = String(saved.doc.id);
    const evidence = reader();
    const request = {
      kind: "document" as const,
      collection: "posts",
      documentId: id,
      projection: "bounded-text" as const,
    };
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
        evidence.read(current, request),
      ),
    ).resolves.toMatchObject({ items: [{ id }] });
    await expect(
      f.admission.withCurrentRun({ siteId: "wrong-site", runId: f.runId }, (current) =>
        evidence.read(current, request),
      ),
    ).rejects.toThrow();
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
        evidence.read(current, { ...request, projection: "schema" }),
      ),
    ).rejects.toThrow();
    await f.db.update(postsTable).set({ visibility: "private" }).where(eq(postsTable.id, id));
    await expect(
      f.admission.withCurrentRun({ siteId, runId: f.runId }, (current) =>
        evidence.read(current, request),
      ),
    ).rejects.toThrow();
  });
});
