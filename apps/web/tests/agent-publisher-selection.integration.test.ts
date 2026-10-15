import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npCreateAgentPublisherSelectionRecipeDefinitionV1,
  npCreateAgentPublisherUncertaintyRecipeDefinitionV1,
} from "../../../packages/core/src/agent-contract/publisher-recipe-contract.js";
import {
  npAgentProviderCalls,
  npAgentChangesetOperations,
  npAgentChangesets,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  getCollectionConfig,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import {
  registerCollection as registerBuiltCollection,
  getCollectionConfig as getBuiltCollectionConfig,
} from "@nexpress/core/collections";
import { createHash } from "node:crypto";
import type { NpCollectionConfig } from "../../../packages/core/src/config/types.js";
import {
  analyzeAgentCanonicalJsonValue,
  serializeAgentCanonicalJson,
} from "../../../packages/core/src/agent-contract/canonical-foundation.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { npCreateAgentPublisherAppRouteInventoryV1 } from "../../../packages/app/src/lib/agents/publisher-route-inventory.js";
import { createAgentCoreRuntimeDocumentEvidenceReaderV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { publisherRuntimeFixture } from "./agent-publisher-recipe-runtime-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof publisherRuntimeFixture>>;
const active: Fixture[] = [];
async function fixture(
  profile: 2 | 3 = 3,
  publisherLimits?: { candidateLimit: number; batchSize: number },
) {
  const recipe = await (profile === 3
    ? npCreateAgentPublisherSelectionRecipeDefinitionV1()
    : npCreateAgentPublisherUncertaintyRecipeDefinitionV1());
  const f = await publisherRuntimeFixture({ recipe, publisherLimits });
  active.push(f);
  return f;
}
describe.skipIf(skipIfNoTestDb())("Publisher versioned immutable selection receipt", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of active.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  it("persists a bounded content-free receipt before fake provider dispatch and preserves it after source changes", async () => {
    const f = await fixture();
    const id = await f.document();
    f.finishAfterCreate();
    f.setBeforeProposal(async () => {
      const [call] = await f.db.select().from(npAgentProviderCalls);
      expect(call.state).toBe("in_flight");
      expect(call.requestRedacted).toMatchObject({
        schemaVersion: "np.agent-publisher-selection-diagnostic.v2",
        requestDigest: call.requestDigest,
        selectionReceipt: {
          schemaVersion: "np.agent-publisher-selection-receipt.v1",
          criteria: { collectionSlugs: ["posts"], candidateLimit: 1, batchSize: 1 },
          counts: { scanned: 1, admitted: 1, selected: 1 },
          exclusions: [],
        },
      });
      const snapshot = call.requestRedacted?.candidateSnapshot;
      expect(snapshot).toEqual([
        expect.objectContaining({
          documentId: id,
          collection: "posts",
          evidenceId: "publisher-content-000",
          base: { version: expect.any(String), digest: expect.stringMatching(/^cj1:sha256:/) },
          contentDigest: expect.stringMatching(/^cj1:sha256:/),
        }),
      ]);
      const selection = f.invoke.mock.calls[0][0].trustedContext.find(
        (entry) => entry.id === "publisher-candidates",
      )!;
      expect(call.requestRedacted?.selectionDigest).toBe(selection.digest);
      expect(selection.digest).toBe(
        `cj1:sha256:${createHash("sha256")
          .update(
            `np.agent-runtime-publisher-candidates.v1\0${serializeAgentCanonicalJson(JSON.parse(selection.text))}`,
          )
          .digest("base64url")}`,
      );
      expect(call.classificationManifest).toMatchObject({
        components: expect.arrayContaining([
          expect.objectContaining({ id: "publisher-candidates", sourceDigest: selection.digest }),
        ]),
      });
      expect(call.diagnosticExpiresAt?.getTime()).toBe(call.createdAt.getTime() + 30 * 86400000);
      const diagnostic = JSON.stringify(call.requestRedacted);
      expect(diagnostic).not.toContain("Untrusted body marker");
      expect(diagnostic).not.toContain('schema":');
    });
    expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(2);
    const calls = await f.db.select().from(npAgentProviderCalls);
    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) => call.instructionTemplateVersion === 3 && call.requestRedacted !== null),
    ).toBe(true);
    await f.db
      .update(postsTable)
      .set({ title: "Independent later edit", updatedAt: new Date() })
      .where(eq(postsTable.id, id));
    expect(
      (await f.db.select().from(npAgentProviderCalls)).map((call) => call.requestRedacted),
    ).toEqual(calls.map((call) => call.requestRedacted));
  });

  it("creates, validates and renders two current nested SEO/rich-text proposals while retaining exact bases and public rows", async () => {
    const config = getCollectionConfig("posts");
    registerCollection("posts", postsTable, {
      ...config,
      fields: [
        ...config.fields.filter(
          (field) =>
            !("name" in field && ["seoMetaTitle", "seoMetaDescription"].includes(field.name)),
        ),
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "metaTitle", type: "text", maxLength: 64 },
            { name: "metaDescription", type: "textarea", maxLength: 160 },
          ],
        },
      ],
    });
    const f = await fixture(3, { candidateLimit: 10, batchSize: 2 });
    const ids = [await f.document(), await f.document()];
    const rich = npCreateEmptyRichTextContent();
    rich.document.root.children = [
      {
        type: "link",
        version: 1,
        url: "/library",
        children: [{ type: "text", version: 1, text: "Library" }],
      },
    ];
    const content = analyzeAgentCanonicalJsonValue(rich);
    if (!content.ok) throw new Error("Invalid rich-text JSON fixture");
    f.setBatchPatches((index) => ({
      seo: {
        metaTitle: `Reviewed title ${index + 1}`,
        metaDescription: "Grounded public library reference.",
      },
      content: content.value,
    }));
    const before = await f.db.select().from(postsTable);
    f.assertDuringPreview(async () => {
      const docs = await Promise.all(ids.map((id) => f.readDocument(id)));
      expect(docs.map((doc) => (doc?.seo as Record<string, unknown>)?.metaTitle).sort()).toEqual([
        "Reviewed title 1",
        "Reviewed title 2",
      ]);
      expect(
        docs.every(
          (doc) => serializeAgentCanonicalJson(doc?.content) === serializeAgentCanonicalJson(rich),
        ),
      ).toBe(true);
    });
    const result = await f.executor.process({ siteId, runId: f.runId });
    const [retained] = await f.db
      .select({ errorCode: npAgentRuns.errorCode })
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, f.runId));
    expect({ ...result, errorCode: retained.errorCode }).toEqual({
      state: "succeeded",
      errorCode: null,
    });
    expect(f.invoke).toHaveBeenCalledTimes(5);
    expect(f.render).toHaveBeenCalled();
    expect(await f.previews()).toEqual([expect.objectContaining({ state: "ready" })]);
    expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);
    const operations = await f.db.select().from(npAgentChangesetOperations);
    expect(operations).toHaveLength(2);
    expect(await f.db.select().from(postsTable)).toEqual(before);
    const first = f.invoke.mock.calls[0][0].trustedContext.find(
      (entry) => entry.id === "publisher-candidates",
    )!;
    const selected = JSON.parse(first.text).candidates as Array<{
      documentId: string;
      base: unknown;
    }>;
    expect(selected.map((entry) => entry.documentId).sort()).toEqual([...ids].sort());
    for (const entry of selected) {
      const operation = operations.find(
        (operation) =>
          operation.resourceKey.kind === "document" &&
          operation.resourceKey.documentId === entry.documentId,
      );
      expect(operation?.baseVersion).toEqual(entry.base);
    }
  }, 60_000);

  it("does not advertise an anonymous document-specific denied canonical route", async () => {
    const f = await fixture(3, { candidateLimit: 10, batchSize: 3 });
    const restricted = await f.document();
    const publicId = await f.document();
    const config = getCollectionConfig("posts");
    const built = getBuiltCollectionConfig("posts");
    const deniedConfig: NpCollectionConfig = {
      ...config,
      access: {
        ...config.access,
        read: ({ user, doc }) => Boolean(user) || !doc || doc.id !== restricted,
      },
    };
    registerCollection("posts", postsTable, deniedConfig);
    registerBuiltCollection("posts", postsTable, deniedConfig);
    const inventory = npCreateAgentPublisherAppRouteInventoryV1({
      authorize: async () => {},
      collectionSlugs: ["posts"],
      fixedRoutes: [],
      publicSurfaceComplete: true,
    });
    let result: Awaited<ReturnType<typeof inventory>>;
    try {
      result = await f.admission.withRunAuthority({ siteId, runId: f.runId }, inventory);
    } finally {
      registerBuiltCollection("posts", postsTable, built);
    }
    const [publicDoc] = await f.db
      .select({ slug: postsTable.slug })
      .from(postsTable)
      .where(eq(postsTable.id, publicId));
    const [restrictedDoc] = await f.db
      .select({ slug: postsTable.slug })
      .from(postsTable)
      .where(eq(postsTable.id, restricted));
    expect(result).toEqual({
      siteId,
      complete: false,
      routes: [{ path: `/blog/${publicDoc.slug}`, updatedAt: expect.any(String) }],
    });
    expect(JSON.stringify(result)).not.toContain(restrictedDoc.slug);
    const candidates = await f.admission.withRunAuthority({ siteId, runId: f.runId }, (context) =>
      f.reader.publisherCandidates(context),
    );
    expect(candidates.candidates.map((candidate) => candidate.documentId)).toEqual([publicId]);
    expect(candidates.selectionReceipt).toMatchObject({
      coverage: { candidateSample: "partial" },
      counts: { scanned: 1, admitted: 1, selected: 1 },
      exclusions: [],
    });
    expect(JSON.stringify(candidates)).not.toContain(restricted);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("preserves the existing V2 provider metadata and leaves its diagnostic body absent", async () => {
    const f = await fixture(2);
    await f.document({ old: false });
    expect(await f.executor.process({ siteId, runId: f.runId })).toEqual({ state: "succeeded" });
    expect(f.invoke).toHaveBeenCalledTimes(1);
    const metadata = f.invoke.mock.calls[0][0].trustedContext.find(
      (entry) => entry.id === "publisher-candidates",
    );
    expect(JSON.parse(metadata!.text)).not.toHaveProperty("selectionReceipt");
    const [call] = await f.db.select().from(npAgentProviderCalls);
    expect(call.instructionTemplateVersion).toBe(2);
    expect(call.requestRedacted).toBeNull();
    expect(call.diagnosticExpiresAt).toBeNull();
  });

  it("ranks multiple current public candidates using real canonical routes, SEO titles and rich-text stale references", async () => {
    const f = await fixture(3, { candidateLimit: 10, batchSize: 3 });
    const brokenId = await f.document();
    const missingTitleId = await f.document();
    const referenceId = await f.document();
    const freshId = await f.document({ old: false });
    const draftId = await f.document({ status: "draft" });
    const otherSiteId = await f.document({ siteId: "draft-other" });
    const [referenceTarget] = await f.db
      .select({ slug: postsTable.slug })
      .from(postsTable)
      .where(eq(postsTable.id, missingTitleId));
    const linked = (url: string) => {
      const value = npCreateEmptyRichTextContent();
      value.document.root.children = [
        {
          type: "link",
          version: 1,
          url,
          children: [{ type: "text", version: 1, text: "Reference" }],
        },
      ];
      return value;
    };
    await f.db
      .update(postsTable)
      .set({ content: linked("/confirmed-absent-route") })
      .where(eq(postsTable.id, brokenId));
    await f.db
      .update(postsTable)
      .set({ seoMetaDescription: "Existing grounded description." })
      .where(eq(postsTable.id, missingTitleId));
    await f.db
      .update(postsTable)
      .set({
        seoMetaTitle: "Existing title",
        seoMetaDescription: "Existing description",
        content: linked(`/blog/${referenceTarget.slug}`),
      })
      .where(eq(postsTable.id, referenceId));
    const inventory = npCreateAgentPublisherAppRouteInventoryV1({
      authorize: async (context) => {
        expect(context.siteId).toBe(siteId);
        expect(context.staffUser?.id).toBe(f.actor.actor.user.id);
      },
      collectionSlugs: ["posts"],
      fixedRoutes: [{ loc: "/" }, { loc: "/blog" }, { loc: "/boards" }, { loc: "/search" }],
      publicSurfaceComplete: true,
    });
    const reader = createAgentCoreRuntimeDocumentEvidenceReaderV1({
      cursorHmacKey: { id: "publisher-selection-test", key: new Uint8Array(32).fill(89) },
      resolveUser: () => f.actor.actor.user,
      resolveBlockSchemas: () => [],
      publisherRouteInventory: inventory,
    });
    const result = await f.admission.withRunAuthority({ siteId, runId: f.runId }, (context) =>
      reader.publisherCandidates(context),
    );
    expect(result.candidates.map((entry) => entry.documentId)).toEqual([
      brokenId,
      missingTitleId,
      referenceId,
    ]);
    expect(result.candidates[0].findings).toContain("broken-internal-link");
    expect(result.candidates[1].findings).toContain("missing-seo-title");
    expect(result.candidates[1].findings).not.toContain("missing-seo-description");
    expect(result.candidates[2].findings).toContain("stale-reference");
    expect(result.candidates[2].findings).not.toContain("broken-internal-link");
    expect(result.selectionReceipt).toMatchObject({
      criteria: { candidateLimit: 10, batchSize: 3 },
      counts: { scanned: 3, admitted: 3, selected: 3 },
      coverage: { candidateSample: "complete", routeInventory: "complete" },
      exclusions: [],
    });
    for (const id of [freshId, draftId, otherSiteId])
      expect(JSON.stringify(result)).not.toContain(id);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(await f.db.select().from(npAgentProviderCalls)).toEqual([]);
  });
});
