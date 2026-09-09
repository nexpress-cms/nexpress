/* eslint-disable import-x/no-relative-packages */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixture,
  command,
  previewConfiguration,
  previewStorageFixture,
  siteId,
} from "./agent-changeset-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
import { npSessions, npRevisions } from "../../../packages/core/src/db/schema/system.js";
import {
  npAgentChangesetPreviews,
  npAgentPreviewArtifacts,
  npAgentPreviewArtifactUploads,
} from "../../../packages/core/src/db/schema/agent.js";
import { findDocuments } from "../../../packages/core/src/collections/pipeline.js";
import { npRequireAgentPreviewReportV1 } from "../../../packages/core/src/agent-contract/changeset-wire-contract.js";
import { npGetAgentChangeSetPreviewContext } from "../../../packages/core/src/agent/changeset-preview-overlay.js";
import { postsTable } from "../src/db/generated/collections.js";
const route = { route: "/", locale: null, audience: "public" as const };
const html =
  '<html lang="en"><head><title>Preview</title><meta name="description" content="Preview"></head><body><a href="/">Home</a></body></html>';
function configuration() {
  const config = previewConfiguration(),
    storage = previewStorageFixture();
  return {
    ...config,
    storageAdapter: storage.adapter,
    resolveAdapter: () => storage.adapter,
    checks: {
      rendererId: config.contract.rendererId,
      rendererVersion: config.contract.rendererVersion,
      rendererFingerprint: config.contract.rendererFingerprint,
      productionOrigins: ["https://site.example"],
      resolveManifest: () => Promise.resolve([route]),
      render: () => Promise.resolve(html),
    },
  };
}
async function queued(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.service.create({ actor: f.actor, command: await command() });
  const sealed = await f.service.validate({
    actor: f.actor,
    id: created.id,
    command: { idempotencyKey: randomUUID(), expectedVersion: 1 },
  });
  const preview = await f.service.preview({
    actor: f.actor,
    id: created.id,
    command: {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      expectedPlanHash: sealed.planHash,
    },
  });
  return { sealed, preview };
}
async function noArtifacts(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.db.select().from(npAgentPreviewArtifacts)).toEqual([]);
  expect(await f.db.select().from(npAgentPreviewArtifactUploads)).toEqual([]);
  const [row] = await f.db.select().from(npAgentChangesetPreviews);
  expect(row.state).toBe("failed");
  expect(row.checkSummary).toMatchObject({ checksRun: 0 });
}
describe.skipIf(skipIfNoTestDb())("sealed framework preview checks", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("renders proposed content through the same sealed read-only overlay and stores only its safe evidence", async () => {
    const config = configuration();
    const f = await fixture({ preview: config });
    const seen: string[] = [];
    config.checks.resolveManifest = async () => {
      expect(npGetAgentChangeSetPreviewContext()?.siteId).toBe(siteId);
      return [route];
    };
    config.checks.render = async () => {
      const context = npGetAgentChangeSetPreviewContext();
      expect(context).not.toBeNull();
      expect(await context!.tx.execute(sql`show transaction_read_only`)).toMatchObject({
        rows: [{ transaction_read_only: "on" }],
      });
      expect(context!.plan.body.operations[0].beforeHash).toBeNull();
      const docs = await findDocuments("posts", { where: { status: "draft" } }, f.actor.actor.user);
      expect(docs.docs).toMatchObject([{ title: "Proposed post", status: "draft" }]);
      seen.push(String(docs.docs[0].title));
      return html.replace("<title>Preview</title>", `<title>${String(docs.docs[0].title)}</title>`);
    };
    const { sealed, preview } = await queued(f);
    expect(await f.service.processPreview({ siteId, previewId: preview.previewId })).toEqual({
      state: "ready",
    });
    const detail = await f.service.getPreview({ actor: f.actor, previewId: preview.previewId });
    expect(Date.parse(detail.artifactRefs[0].expiresAt)).toBe(
      Date.parse(detail.completedAt!) + 7 * 24 * 60 * 60 * 1000,
    );
    expect(Date.parse(detail.artifactRefs[0].createdAt)).toBeLessThanOrEqual(
      Date.parse(detail.completedAt!),
    );
    const artifact = await f.service.readPreviewArtifact({
      actor: f.actor,
      previewId: preview.previewId,
      artifactId: detail.artifactRefs[0].artifactId,
    });
    const text = new TextDecoder().decode(artifact.bytes),
      report = npRequireAgentPreviewReportV1(JSON.parse(text));
    expect(report.planHash).toBe(sealed.planHash);
    expect(report.generation).toBe(preview.generation);
    expect(report.results).toHaveLength(5);
    expect(report.issues).toEqual([]);
    expect(seen).toEqual(["Proposed post"]);
    expect(text).not.toContain("Proposed post");
    expect(await f.db.select().from(postsTable)).toEqual([]);
    expect(await f.db.select().from(npRevisions)).toEqual([]);
  });
  it("discards rendered evidence when the admitting session is revoked during rendering", async () => {
    const config = configuration(),
      f = await fixture({ preview: config });
    config.checks.render = async () => {
      await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
      return html;
    };
    const { preview } = await queued(f);
    expect(await f.service.processPreview({ siteId, previewId: preview.previewId })).toEqual({
      state: "failed",
    });
    await noArtifacts(f);
    const [row] = await f.db.select().from(npAgentChangesetPreviews);
    expect(row.errorCode).toBe("AUTHORITY_REVOKED");
  });
  it("discards the complete generation when current authority is revoked during the bodyless HEAD", async () => {
    const config = configuration(),
      f = await fixture({ preview: config });
    config.contract.linkAllowlistOrigins = ["https://reviewed.example"];
    config.checks.render = () =>
      Promise.resolve(
        html.replace("</body>", '<a href="https://reviewed.example/path">Link</a></body>'),
      );
    const originalLookup = dns.lookup;
    vi.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      options: Parameters<typeof dns.lookup>[1],
    ) =>
      hostname === "reviewed.example"
        ? Promise.resolve([{ address: "93.184.216.34", family: 4 }])
        : originalLookup(hostname, options)) as never);
    const head = vi.spyOn(https, "request").mockImplementation(((
      _options: unknown,
      callback: (response: unknown) => void,
    ) => {
      const request = new EventEmitter();
      Object.assign(request, {
        end: () => {
          void f.db
            .delete(npSessions)
            .where(eq(npSessions.id, f.actor.actor.sessionId))
            .then(() => callback({ statusCode: 204, destroy: () => undefined }));
        },
      });
      return request;
    }) as never);
    syncBuiltinESMExports();
    const { preview } = await queued(f);
    expect(await f.service.processPreview({ siteId, previewId: preview.previewId })).toEqual({
      state: "failed",
    });
    expect(head).toHaveBeenCalledOnce();
    await noArtifacts(f);
  });
  it("rejects changed frozen checker identity before host rendering and report reservation", async () => {
    const config = configuration(),
      f = await fixture({ preview: config });
    const { preview } = await queued(f);
    const render = vi.fn(() => Promise.resolve(html));
    config.checks.render = render;
    config.checks.rendererVersion = 2;
    expect(await f.service.processPreview({ siteId, previewId: preview.previewId })).toEqual({
      state: "failed",
    });
    expect(render).not.toHaveBeenCalled();
    await noArtifacts(f);
  });
  it("fails a malformed or oversized rendered page without publishing partial report artifacts", async () => {
    const config = configuration(),
      f = await fixture({ preview: config });
    config.checks.render = () => Promise.resolve("a".repeat(5 * 1024 * 1024 + 1));
    const { preview } = await queued(f);
    expect(await f.service.processPreview({ siteId, previewId: preview.previewId })).toEqual({
      state: "failed",
    });
    await noArtifacts(f);
  });
});
