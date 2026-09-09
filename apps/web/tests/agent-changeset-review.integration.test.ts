/* eslint-disable import-x/no-relative-packages */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  fixture,
  principalFixture,
  draft,
  command,
  previewConfiguration,
  readyPreview,
  siteId,
  previewStorageFixture,
} from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
  getTestDatabaseUrl,
} from "./harness.js";
import {
  npAgentInvocations,
  npAgentChangesets,
  npAgentPrincipals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  createDbConnection,
  npCloseDbConnection,
} from "../../../packages/core/src/db/connection.js";
import { setDb } from "../../../packages/core/src/db/runtime.js";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npRequireAgentPreviewReportV1 } from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";

describe.skipIf(skipIfNoTestDb())("ChangeSet review and propose surfaces", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("projects sealed proposed values and no snapshots, then rejects revoked viewer authority", async () => {
    const f = await fixture();
    const created = await f.service.create({ actor: f.actor, command: await command() });
    expect(
      (await f.service.getReview({ actor: f.actor, id: created.id })).operations[0].evidence,
    ).toBe("not_validated");
    await f.service.validate({
      actor: f.actor,
      id: created.id,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
    });
    const review = await f.service.getReview({ actor: f.actor, id: created.id });
    expect(review.operations[0]).toMatchObject({
      evidence: "available",
      fields: expect.arrayContaining([
        {
          path: "title",
          before: { presence: "absent", value: null },
          after: { presence: "present", value: "Proposed post" },
        },
      ]),
    });
    expect(JSON.stringify(review)).not.toMatch(
      /beforeSnapshot|sealedPlanBody|authorizationContextBody/,
    );
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(f.service.getReview({ actor: f.actor, id: created.id })).rejects.toThrow();
  });
  it("binds filters to bounded cursors and rejects malformed date/state inputs", async () => {
    const f = await fixture();
    await f.service.create({ actor: f.actor, command: await command(draft("one")) });
    await f.service.create({ actor: f.actor, command: await command(draft("two")) });
    const page = await f.service.list({
      actor: f.actor,
      limit: 1,
      states: ["draft"],
      actorKinds: ["staff"],
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    await expect(
      f.service.list({
        actor: f.actor,
        limit: 1,
        states: ["ready"],
        actorKinds: ["staff"],
        cursor: page.nextCursor!,
      }),
    ).rejects.toThrow();
    expect((await f.service.list({ actor: f.actor, states: ["ready"] })).items).toEqual([]);
    await expect(f.service.list({ actor: f.actor, createdAfter: "2026-01-01" })).rejects.toThrow();
  });
  it("uses one existing invocation for idempotent create and exact hash-bound validate", async () => {
    const f = await fixture();
    const p = await principalFixture(f);
    expect(
      (await p.admission.project({ authentication: p.authentication })).entries.map(
        (entry) => entry.definition.descriptor.id,
      ),
    ).not.toContain("changeset.preview");
    await expect(
      p.admission.invoke({
        authentication: p.authentication,
        request: {
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId: "changeset.preview",
          arguments: {
            input: { changeSetId: randomUUID(), planHash: `cj1:sha256:${"a".repeat(43)}` },
            idempotencyKey: randomUUID(),
          },
        },
      }),
    ).rejects.toThrow();
    const request = {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "changeset.create" as const,
      arguments: { input: draft(), idempotencyKey: randomUUID() },
    };
    const first = await p.admission.invoke({ authentication: p.authentication, request });
    const replay = await p.admission.invoke({ authentication: p.authentication, request });
    expect(replay.invocationId).toBe(first.invocationId);
    const rows = await f.db.select().from(npAgentInvocations);
    const creates = rows.filter((r) => r.operationId === "changeset.create");
    expect(creates).toHaveLength(1);
    expect(creates[0].requestBody.input).toEqual(request.arguments.input);
    expect(creates[0].requestBody.input).not.toHaveProperty("proposalJson");
    const [row] = await f.db.select().from(npAgentChangesets);
    const validate = {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "changeset.validate" as const,
      arguments: {
        input: { changeSetId: row.id, draftVersion: 1, draftHash: row.draftHash },
        idempotencyKey: randomUUID(),
      },
    };
    await expect(
      p.admission.invoke({
        authentication: p.authentication,
        request: {
          ...validate,
          arguments: {
            ...validate.arguments,
            input: { ...validate.arguments.input, draftHash: `cj1:sha256:${"a".repeat(43)}` },
          },
        },
      }),
    ).rejects.toThrow();
    await p.admission.invoke({ authentication: p.authentication, request: validate });
    expect((await p.service.get({ actor: p.actor, id: row.id })).state).toBe("ready");
    const get = {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "changeset.get" as const,
      arguments: { input: { changeSetId: row.id }, idempotencyKey: null },
    };
    const read = await p.admission.invoke({ authentication: p.authentication, request: get });
    expect(read).not.toHaveProperty("actionId");
    expect(read).not.toHaveProperty("runId");
    await f.db
      .update(npAgentPrincipals)
      .set({ tokenVersion: 2 })
      .where(eq(npAgentPrincipals.id, p.principal.resourceId));
    await expect(
      p.admission.invoke({ authentication: p.authentication, request: get }),
    ).rejects.toThrow();
  });
  it("runs checks into the same private artifact set and serves only safe structured evidence", async () => {
    const { adapter } = previewStorageFixture();
    const configuration = previewConfiguration();
    const route = { route: "/", locale: null, audience: "public" as const };
    const f = await fixture({
      preview: {
        ...configuration,
        storageAdapter: adapter,
        resolveAdapter: () => adapter,
        checks: {
          rendererId: configuration.contract.rendererId,
          rendererVersion: configuration.contract.rendererVersion,
          rendererFingerprint: configuration.contract.rendererFingerprint,
          productionOrigins: ["https://site.example"],
          resolveManifest: async () => [route],
          render: async () =>
            '<html lang="en"><head><title>Private text never in evidence</title><meta name="description" content="Description"></head><body><main><img src="/a.png"><a href="https://unreviewed.example/path?secret=hidden">Private link</a></main></body></html>',
        },
      },
    });
    const detail = await readyPreview(f);
    expect(detail.state).toBe("ready");
    expect(detail.checkSummary).toMatchObject({
      checksRun: 5,
      warningCodes: ["SCREENSHOTS_UNAVAILABLE"],
    });
    expect(detail.artifactRefs).toHaveLength(1);
    const connectionString = getTestDatabaseUrl();
    if (!connectionString) throw new Error("Test database required");
    const single = createDbConnection({
      connectionString,
      poolOptions: { max: 1, connectionTimeoutMillis: 1000 },
    });
    setDb(single);
    try {
      const review = await f.service.getReview({ actor: f.actor, id: detail.changeSetId });
      expect(review.changeSet.preview?.previewId).toBe(detail.previewId);
      expect(review.operations[0].evidence).toBe("available");
    } finally {
      setDb(f.db);
      await npCloseDbConnection(single);
    }
    const artifact = await f.service.readPreviewArtifact({
      actor: f.actor,
      previewId: detail.previewId,
      artifactId: detail.artifactRefs[0].artifactId,
    });
    const text = new TextDecoder().decode(artifact.bytes);
    const report = npRequireAgentPreviewReportV1(JSON.parse(text));
    expect(report.planHash).toBe(detail.planHash);
    expect(report.issues.some((i) => i.code === "ACCESSIBILITY_VIOLATION")).toBe(true);
    expect(text).not.toMatch(/Private text|secret=hidden|Private link|storageKey/);
    await expect(
      f.service.readPreviewArtifact({
        actor: { ...f.actor, siteId: "draft-other" },
        previewId: detail.previewId,
        artifactId: detail.artifactRefs[0].artifactId,
      }),
    ).rejects.toThrow();
    expect(siteId).toBe(report.siteId);
  });
});
