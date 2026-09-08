// eslint-disable-next-line import-x/no-relative-packages
import { setSeoSettings, getSeoSettings } from "../../../packages/core/src/settings/service.js";
// eslint-disable-next-line import-x/no-relative-packages
import { defaultTheme } from "../../../packages/themes/default/src/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { registerThemes, getRegisteredThemes } from "../../../packages/core/src/themes/registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { listMediaReferences } from "../../../packages/core/src/media/refs.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npMedia } from "../../../packages/core/src/db/schema/media.js";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import-x/no-relative-packages
import {
  withAgentChangeSetPreview,
  type NpAgentChangeSetPreviewContextV1,
} from "../../../packages/core/src/agent/changeset-preview-overlay.js";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npDigestAgentChangeSetPlanCanonical } from "../../../packages/core/src/agent-contract/canonical-changeset.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAgentChangeSetProposalOperationCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
// eslint-disable-next-line import-x/no-relative-packages
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  findDocuments,
  saveDocument,
  getDocumentById,
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionRegistration,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getNavigation,
  getSetting,
  setNavigation,
} from "../../../packages/core/src/content/helpers.js";
// eslint-disable-next-line import-x/no-relative-packages
import { getTheme } from "../../../packages/core/src/theme/runtime.js";
// eslint-disable-next-line import-x/no-relative-packages
import { buildPageMetadata } from "../../../packages/core/src/seo/page-metadata.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
// eslint-disable-next-line import-x/no-relative-packages
import type { NpAuthUser } from "../../../packages/core/src/config/types.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
vi.mock("@nexpress/core", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // eslint-disable-next-line import-x/no-relative-packages
  findDocuments: (await import("../../../packages/core/src/collections/pipeline.js")).findDocuments,
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // eslint-disable-next-line import-x/no-relative-packages
  ...(await import("../../../packages/core/src/agent/changeset-preview-overlay.js")),
}));
// eslint-disable-next-line import-x/no-relative-packages
const { createDefaultBlockRenderContext } =
  await import("../../../packages/next/src/block-render-context.js");
const originalThemes = getRegisteredThemes();
const siteId = "default";
const digest = `cj1:sha256:${"A".repeat(43)}`;
async function actor(): Promise<NpAuthUser> {
  const seeded = await seedUser({ role: "admin" });
  return {
    id: seeded.userId,
    email: seeded.email,
    name: seeded.name,
    role: seeded.role,
    tokenVersion: 1,
  };
}
function createEntry(
  title: string,
  status: "draft" | "published",
  ordinal = 1,
): NpAgentChangeSetProposalOperationCanonicalV1 {
  return {
    ordinal,
    canonicalResourceKey: { kind: "document", collection: "posts", documentId: randomUUID() },
    operation: {
      kind: "document",
      operation: "create",
      clientOperationId: `post-${ordinal}`,
      reason: null,
      resource: { collection: "posts", documentId: null },
      base: null,
      input: { document: { title, content: npCreateEmptyRichTextContent() }, targetStatus: status },
    },
  };
}
async function preview<T>(
  user: NpAuthUser,
  entries: NpAgentChangeSetProposalOperationCanonicalV1[],
  render: (context: NpAgentChangeSetPreviewContextV1) => Promise<T>,
): Promise<T> {
  const db = await getTestDb();
  const now = new Date();
  const changeSetId = randomUUID();
  const validated = await withCurrentSite(siteId, () =>
    db.transaction(
      async (tx) => {
        const service = createAgentChangeSetValidationResourceServiceV1();
        const context = { tx: tx as unknown as NpTransaction, siteId, changeSetId, user };
        const operations = [];
        for (const entry of entries) {
          if (entry.operation.base !== null) {
            const read = await service.readBase({ ...context, ...entry });
            operations.push({
              ...entry,
              operation: {
                ...entry.operation,
                base: read.base ?? { version: "absent", digest: read.beforeHash },
              },
            });
          } else operations.push(entry);
        }
        return service.validate({ ...context, now, operations });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ),
  );
  const expiresAt = new Date(now.getTime() + 60000).toISOString();
  const plan: NpAgentChangeSetPreviewContextV1["plan"] = {
    schemaVersion: "np.agent-changeset-plan.v1",
    planKind: "changeset",
    siteId,
    changeSetId,
    body: {
      draftVersion: 1,
      draftHash: digest,
      validationGeneration: 1,
      baseFingerprint: validated.baseFingerprint,
      operations: validated.operations,
      risk: validated.risk,
      requiredScopes: ["changeset:apply", ...validated.requiredApplyScopes].sort(),
      requiredHumanCapabilities: ["admin.manage"],
      requiredHumanPredicates: [],
      policyHashes: validated.policyHashes,
      expiresAt,
      rollbackWindowSeconds: 3600,
    },
  };
  const planHash = await npDigestAgentChangeSetPlanCanonical(plan);
  return db.transaction(
    async (tx) => {
      const context: NpAgentChangeSetPreviewContextV1 = {
        siteId,
        changeSetId,
        previewId: randomUUID(),
        generation: 1,
        planHash,
        previewContractFingerprint: digest,
        route: { route: "/", locale: null, audience: "public" },
        createdAt: now.toISOString(),
        expiresAt,
        plan,
        snapshots: validated.snapshots,
        now: new Date(),
        tx: tx as unknown as NpTransaction,
      };
      return withAgentChangeSetPreview(context, () => render(context));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
describe.skipIf(skipIfNoTestDb())("readonly ChangeSet preview overlay", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
    registerThemes([defaultTheme]);
  });
  afterEach(async () => {
    registerTestCollections();
    await truncateAll();
  });
  afterAll(async () => {
    registerThemes(originalThemes);
    await closeTestDb();
  });
  it("uses normal published search, sorting and bounded pages for virtual creates without creating a row", async () => {
    const user = await actor();
    await withCurrentSite(siteId, () =>
      saveDocument(
        "posts",
        null,
        { title: "Original", content: npCreateEmptyRichTextContent() },
        user,
        { status: "published" },
      ),
    );
    const entries = [
      createEntry("Preview Alpha", "published"),
      createEntry("Preview Bravo", "published", 2),
      createEntry("Preview Hidden", "draft", 3),
    ];
    await preview(user, entries, async (context) => {
      const first = await findDocuments("posts", {
        where: { status: "published" },
        search: "Preview",
        sort: "title",
        limit: 1,
      });
      expect(first.totalDocs).toBe(2);
      const blocks = createDefaultBlockRenderContext();
      expect(await blocks.content.count("posts")).toBe(3);
      const hidden = entries[2].canonicalResourceKey;
      if (hidden.kind !== "document") throw new Error("document");
      expect(await blocks.content.findOne("posts", hidden.documentId)).toBeNull();
      expect(first.docs[0]).toMatchObject({
        title: "Preview Alpha",
        status: "published",
        createdAt: new Date(context.createdAt),
      });
      const second = await findDocuments("posts", {
        where: { status: "published" },
        search: "Preview",
        sort: "title",
        limit: 1,
        page: 2,
      });
      expect(second.docs[0]).toMatchObject({ title: "Preview Bravo" });
      const all = await findDocuments("posts", { where: { status: "published" }, sort: "title" });
      expect(all.totalDocs).toBe(3);
      const entry = entries[0];
      if (entry.canonicalResourceKey.kind !== "document") throw new Error("document");
      expect(await getDocumentById("posts", entry.canonicalResourceKey.documentId)).toMatchObject({
        title: "Preview Alpha",
      });
      await expect(
        npGetPersistedCollectionDocumentById(
          "posts",
          entry.canonicalResourceKey.documentId,
          "other",
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(saveDocument("posts", null, { title: "forbidden" }, user)).rejects.toMatchObject(
        { statusCode: 403 },
      );
    });
    expect((await findDocuments("posts", { where: { status: "published" } })).totalDocs).toBe(1);
  });
  it("skips effectful read hooks while preserving item visibility checks", async () => {
    const user = await actor();
    const entry = createEntry("Visible preview", "published");
    const hooks = vi.fn(({ data }) => data);
    const registration = getCollectionRegistration("posts");
    registerCollection(
      "posts",
      registration.table,
      { ...registration.config, hooks: { afterRead: [hooks] } },
      { joinTables: registration.joinTables },
    );
    await preview(user, [entry], async () => {
      expect((await findDocuments("posts", { where: { status: "published" } })).totalDocs).toBe(1);
      expect(hooks).not.toHaveBeenCalled();
    });
    registerCollection(
      "posts",
      registration.table,
      {
        ...registration.config,
        access: { read: ({ doc }) => !doc || doc.title !== "Visible preview" },
      },
      { joinTables: registration.joinTables },
    );
    await expect(
      preview(user, [entry], () => findDocuments("posts", { where: { status: "published" } })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projects navigation and SEO into normal reads while unrelated theme reads fall through", async () => {
    const user = await actor();
    const entries: NpAgentChangeSetProposalOperationCanonicalV1[] = [
      {
        ordinal: 1,
        canonicalResourceKey: { kind: "navigation", location: "header" },
        operation: {
          clientOperationId: "nav",
          reason: null,
          kind: "navigation",
          operation: "replace",
          resource: { location: "header" },
          base: { version: "pending", digest },
          input: {
            items: [{ id: "preview-link", type: "link", label: "Preview", url: "/preview" }],
          },
        },
      },
      {
        ordinal: 2,
        canonicalResourceKey: { kind: "setting", key: "seo" },
        operation: {
          clientOperationId: "seo",
          reason: null,
          kind: "setting",
          operation: "replace",
          resource: { key: "seo" },
          base: null,
          input: {
            value: { defaultOgImage: null, twitterHandle: "preview", defaultLocale: "ko_KR" },
          },
        },
      },
    ];
    await setNavigation("header", [], user);
    const theme = await getTheme();
    await preview(user, entries, async () => {
      expect(await getNavigation()).toMatchObject([{ label: "Preview", url: "/preview" }]);
      expect(await getSetting("seo")).toMatchObject({ twitterHandle: "preview" });
      expect(await buildPageMetadata({ title: "Overlay" })).toMatchObject({
        openGraph: { locale: "ko_KR" },
        twitter: { site: "@preview" },
      });
      expect(await getTheme()).toEqual(theme);
    });
    expect(await getSetting("seo")).toBeNull();
    expect(await getNavigation()).toEqual([]);
  });
  it("overlays stored updates and hasMany membership, active theme tokens and media inventory without changing owner values", async () => {
    const user = await actor();
    const db = await getTestDb();
    const category = await saveDocument("categories", null, { name: "Preview category" }, user);
    const post = await saveDocument(
      "posts",
      null,
      { title: "Before", content: npCreateEmptyRichTextContent(), categories: [] },
      user,
      { status: "published" },
    );
    const documentId = String(post.doc.id);
    const [media] = await db
      .insert(npMedia)
      .values({
        siteId,
        filename: "fixture.png",
        originalFilename: "fixture.png",
        mimeType: "image/png",
        filesize: 1,
        storageKey: "fixture-object",
        hash: "fixture-hash",
        status: "ready",
      })
      .returning({ id: npMedia.id });
    const resource = { mediaId: media!.id, collection: "posts", documentId, field: "coverImage" };
    const entries: NpAgentChangeSetProposalOperationCanonicalV1[] = [
      {
        ordinal: 1,
        canonicalResourceKey: { kind: "document", collection: "posts", documentId },
        operation: {
          clientOperationId: "update",
          reason: null,
          kind: "document",
          operation: "update",
          resource: { collection: "posts", documentId },
          base: { version: "pending", digest },
          input: {
            patch: { title: "After", categories: [String(category.doc.id)] },
            targetStatus: null,
          },
        },
      },
      {
        ordinal: 2,
        canonicalResourceKey: { kind: "theme_tokens", themeId: defaultTheme.manifest.id },
        operation: {
          clientOperationId: "theme",
          reason: null,
          kind: "theme_tokens",
          operation: "replace",
          resource: { themeId: defaultTheme.manifest.id },
          base: { version: "pending", digest },
          input: { tokens: { colors: { primary: "#123456" } } },
        },
      },
      {
        ordinal: 3,
        canonicalResourceKey: { kind: "media_ref", ...resource },
        operation: {
          clientOperationId: "media",
          reason: null,
          kind: "media_ref",
          operation: "attach",
          resource,
          base: { version: "pending", digest },
          input: {},
        },
      },
    ];
    await preview(user, entries, async () => {
      expect(
        (
          await findDocuments("posts", {
            where: { categories: String(category.doc.id), status: "published" },
          })
        ).docs,
      ).toMatchObject([{ id: documentId, title: "After", categories: [category.doc.id] }]);
      expect(await getTheme()).toMatchObject({ colors: { primary: "#123456" } });
      expect(await listMediaReferences(media!.id)).toEqual([{ siteId, ...resource }]);
      expect(await getDocumentById("posts", documentId)).toMatchObject({ coverImage: null });
    });
    expect(await getDocumentById("posts", documentId)).toMatchObject({
      title: "Before",
      categories: [],
      coverImage: null,
    });
    expect(await listMediaReferences(media!.id)).toEqual([]);
    expect((await getTheme()).colors.primary).not.toBe("#123456");
  });
  it("preserves sealed target status across preview clocks when publishedAt is in the future", async () => {
    const user = await actor();
    const entry = createEntry("Future intent", "published");
    if (entry.operation.kind !== "document" || entry.operation.operation !== "create")
      throw new Error("create");
    entry.operation.input.document.publishedAt = new Date(Date.now() + 30000).toISOString();
    await preview(user, [entry], async (context) => {
      const original = await findDocuments("posts", { where: { status: "published" } });
      expect(original.totalDocs).toBe(1);
      const changedClock = {
        ...context,
        createdAt: new Date(context.now.getTime() + 40000).toISOString(),
        now: new Date(context.now.getTime() + 40000),
      };
      await withAgentChangeSetPreview(changedClock, async () => {
        expect((await findDocuments("posts", { where: { status: "published" } })).totalDocs).toBe(
          original.totalDocs,
        );
      });
    });
  });
  it("projects exact detach and SEO absence without changing persisted references or settings", async () => {
    const user = await actor();
    const db = await getTestDb();
    const [media] = await db
      .insert(npMedia)
      .values({
        siteId,
        filename: "fixture.png",
        originalFilename: "fixture.png",
        mimeType: "image/png",
        filesize: 1,
        storageKey: "fixture-object",
        hash: "fixture-hash",
        status: "ready",
      })
      .returning({ id: npMedia.id });
    const saved = await saveDocument(
      "posts",
      null,
      { title: "Owner", content: npCreateEmptyRichTextContent(), coverImage: media!.id },
      user,
      { status: "published" },
    );
    const resource = {
      mediaId: media!.id,
      collection: "posts",
      documentId: String(saved.doc.id),
      field: "coverImage",
    };
    await setSeoSettings(
      { defaultOgImage: null, twitterHandle: "before", defaultLocale: "ko_KR" },
      user.id,
    );
    const entries: NpAgentChangeSetProposalOperationCanonicalV1[] = [
      {
        ordinal: 1,
        canonicalResourceKey: { kind: "media_ref", ...resource },
        operation: {
          clientOperationId: "detach",
          reason: null,
          kind: "media_ref",
          operation: "detach",
          resource,
          base: { version: "pending", digest },
          input: {},
        },
      },
      {
        ordinal: 2,
        canonicalResourceKey: { kind: "setting", key: "seo" },
        operation: {
          clientOperationId: "remove",
          reason: null,
          kind: "setting",
          operation: "remove",
          resource: { key: "seo" },
          base: { version: "pending", digest },
          input: {},
        },
      },
    ];
    await preview(user, entries, async () => {
      expect(await listMediaReferences(media!.id)).toEqual([]);
      expect(await getDocumentById("posts", resource.documentId)).toMatchObject({
        coverImage: media!.id,
      });
      expect(await getSetting("seo")).toBeNull();
      expect(await getSeoSettings()).toMatchObject({ twitterHandle: null, defaultLocale: "en_US" });
    });
    expect(await listMediaReferences(media!.id)).toHaveLength(1);
    expect(await getSetting("seo")).toMatchObject({ twitterHandle: "before" });
  });
});
