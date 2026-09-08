// eslint-disable-next-line import-x/no-relative-packages
import { defaultTheme } from "../../../packages/themes/default/src/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import { createSite, npMedia, npNavigation, npSettings, type NpAuthUser } from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentChangeSetResourceServiceV1 } from "../../../packages/core/src/agent/changeset-resources.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  saveDocument,
  npGetPersistedCollectionDocumentById,
} from "../../../packages/core/src/collections/pipeline.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getActiveTheme,
  getRegisteredThemes,
  registerThemes,
} from "../../../packages/core/src/themes/registry.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetResourceKeyV1,
} from "@nexpress/core/agent-contract";
import {
  ensureMigrated,
  closeTestDb,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  registerTestCollections,
} from "./harness.js";
const base = { version: "draft-base", digest: `cj1:sha256:${"A".repeat(43)}` };
const service = createAgentChangeSetResourceServiceV1();
const originalThemes = getRegisteredThemes();
function input(document: Record<string, unknown>): NpAgentChangeSetOperationInput {
  return {
    clientOperationId: "create-post",
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "posts", documentId: null },
    base: null,
    input: { document: document as never, targetStatus: "draft" },
  };
}
const content = () => ({ title: "Draft post", content: npCreateEmptyRichTextContent() });
async function actor() {
  const session = await seedUser();
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    tokenVersion: 1,
  } as NpAuthUser;
}
async function media(siteId: string) {
  const db = await getTestDb();
  const [row] = await db
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
  return row!.id;
}
function prepare(
  user: NpAuthUser,
  operation: NpAgentChangeSetOperationInput,
  resource: NpAgentChangeSetResourceKeyV1,
  reservedCreateDocumentIds: string[] = [],
) {
  return service.prepare({
    siteId: "default",
    user,
    operation,
    canonicalResourceKey: resource,
    reservedCreateDocumentIds,
  });
}

describe.skipIf(skipIfNoTestDb())("ChangeSet resource canonicalization and authority", () => {
  beforeAll(ensureMigrated);
  beforeEach(() => {
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

  it("accepts a stable reserved create without inserting content or invoking write hooks", async () => {
    const user = await actor();
    const id = randomUUID();
    let hooks = 0;
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      hooks: {
        beforeCreate: [
          ({ data }) => {
            hooks++;
            return data;
          },
        ],
      },
    });
    const operation = input({ ...content(), publishedAt: "2026-09-01T09:00:00+09:00" });
    const resource = { kind: "document" as const, collection: "posts", documentId: id };
    const first = await prepare(user, operation, resource, [id]);
    const replay = await prepare(user, operation, resource, [id]);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      operation: {
        input: { document: { slug: "draft-post", publishedAt: "2026-09-01T00:00:00.000Z" } },
      },
      requiredScopes: ["content:draft"],
    });
    expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toBeNull();
    expect(hooks).toBe(0);
  });

  it("omits server defaults from editable input while the existing save pipeline still applies them", async () => {
    const user = await actor();
    const id = randomUUID();
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      fields: original.fields.map((field) => {
        if ("name" in field && field.name === "seedSource")
          return { ...field, hidden: true, defaultValue: "server-seed-default" };
        if ("name" in field && field.name === "excerpt")
          return {
            ...field,
            admin: { ...field.admin, readOnly: true },
            defaultValue: "server-excerpt-default",
          };
        return field;
      }),
    });
    const resource = { kind: "document" as const, collection: "posts", documentId: id };
    const accepted = await prepare(user, input(content()), resource, [id]);
    expect(JSON.stringify(accepted.operation)).not.toMatch(
      /server-seed-default|server-excerpt-default/,
    );
    expect(await prepare(user, accepted.operation, resource, [id])).toEqual(accepted);
    expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toBeNull();
    if (accepted.operation.kind !== "document" || accepted.operation.operation !== "create")
      throw new Error("Expected a create operation");
    expect(accepted.operation.input.document).not.toHaveProperty("seedSource");
    expect(accepted.operation.input.document).not.toHaveProperty("excerpt");
    const saved = await saveDocument("posts", null, accepted.operation.input.document, user, {
      status: "draft",
    });
    expect(
      await npGetPersistedCollectionDocumentById("posts", String(saved.doc.id), "default"),
    ).toMatchObject({
      seedSource: "server-seed-default",
      excerpt: "server-excerpt-default",
    });
  });

  it("merges partial updates only for validation, leaves stored content intact and rechecks item ACL", async () => {
    const user = await actor();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const resource = { kind: "document" as const, collection: "posts", documentId: id };
    const operation: NpAgentChangeSetOperationInput = {
      clientOperationId: "update",
      reason: null,
      kind: "document",
      operation: "update",
      resource: { collection: "posts", documentId: id },
      base,
      input: { patch: { title: "Proposed title" }, targetStatus: null },
    };
    expect(await prepare(user, operation, resource)).toMatchObject({
      operation: { input: { patch: { title: "Proposed title" } } },
    });
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.title).toBe(
      "Draft post",
    );
    const original = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { read: ({ doc }) => doc?.id !== id },
    });
    await expect(
      service.assertVisible({ siteId: "default", user, operation, canonicalResourceKey: resource }),
    ).rejects.toMatchObject({ code: "CHANGESET_RESOURCE_NOT_FOUND" });
    registerCollection("posts", getCollectionTable("posts"), {
      ...original,
      access: { update: () => false },
    });
    await expect(prepare(user, operation, resource)).rejects.toMatchObject({
      code: "CHANGESET_ACCESS_DENIED",
    });
  });

  it("rejects cross-site, deleted and intra-draft media/relationship references", async () => {
    const user = await actor();
    await createSite({ id: "resource-other", name: "Other site" });
    const foreignMedia = await media("resource-other");
    const foreign = await withCurrentSite("resource-other", () =>
      saveDocument("posts", null, content(), user, { status: "draft" }),
    );
    const id = randomUUID();
    const resource = { kind: "document" as const, collection: "posts", documentId: id };
    for (const extra of [
      { coverImage: foreignMedia },
      { parent: String(foreign.doc.id) },
      { parent: id },
    ]) {
      await expect(
        prepare(user, input({ ...content(), ...extra }), resource, [id]),
      ).rejects.toMatchObject({ code: "CHANGESET_REFERENCE_INVALID" });
    }
    const deleted = await media("default");
    await (
      await getTestDb()
    )
      .update(npMedia)
      .set({ deletedAt: new Date() })
      .where(eq(npMedia.id, deleted));
    await expect(
      prepare(user, input({ ...content(), coverImage: deleted }), resource, [id]),
    ).rejects.toMatchObject({ code: "CHANGESET_REFERENCE_INVALID" });
  });

  it("derives nested media and unpublished reference scopes and checks those references on every read", async () => {
    const user = await actor();
    const liveMedia = await media("default");
    const parent = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = randomUUID();
    const operation = input({ ...content(), coverImage: liveMedia, parent: String(parent.doc.id) });
    const resource = { kind: "document" as const, collection: "posts", documentId: id };
    expect(await prepare(user, operation, resource, [id])).toMatchObject({
      requiredScopes: ["content:draft", "content:read", "media:read"],
    });
    expect(
      await service.assertVisible({
        siteId: "default",
        user,
        operation,
        canonicalResourceKey: resource,
      }),
    ).toEqual(["content:draft", "content:read", "media:read"]);
    await (
      await getTestDb()
    )
      .update(npMedia)
      .set({ deletedAt: new Date() })
      .where(eq(npMedia.id, liveMedia));
    await expect(
      service.assertVisible({ siteId: "default", user, operation, canonicalResourceKey: resource }),
    ).rejects.toMatchObject({ code: "CHANGESET_REFERENCE_INVALID" });
  });

  it("accepts the existing navigation, active-theme, SEO and media-reference contracts without writes", async () => {
    const user = await actor();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const docId = String(saved.doc.id);
    const mediaId = await media("default");
    const db = await getTestDb();
    await db.insert(npNavigation).values({ siteId: "default", location: "header", items: [] });
    const nav: NpAgentChangeSetOperationInput = {
      clientOperationId: "nav",
      reason: null,
      kind: "navigation",
      operation: "replace",
      resource: { location: "header" },
      base,
      input: {
        items: [
          { id: "nav-post", type: "page", label: "Post", pageId: docId, collectionSlug: "posts" },
        ],
      },
    };
    expect(await prepare(user, nav, { kind: "navigation", location: "header" })).toMatchObject({
      requiredScopes: ["content:draft", "content:read", "navigation:write"],
    });
    const active = await getActiveTheme();
    expect(active).not.toBeNull();
    const themeId = active!.manifest.id;
    const theme: NpAgentChangeSetOperationInput = {
      clientOperationId: "theme",
      reason: null,
      kind: "theme_tokens",
      operation: "replace",
      resource: { themeId },
      base,
      input: { tokens: {} },
    };
    expect(await prepare(user, theme, { kind: "theme_tokens", themeId })).toMatchObject({
      requiredScopes: ["theme:write"],
    });
    const setting: NpAgentChangeSetOperationInput = {
      clientOperationId: "seo",
      reason: null,
      kind: "setting",
      operation: "replace",
      resource: { key: "seo" },
      base: null,
      input: { value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en" } },
    };
    expect(await prepare(user, setting, { kind: "setting", key: "seo" })).toMatchObject({
      requiredScopes: ["settings:write"],
    });
    const ref: NpAgentChangeSetOperationInput = {
      clientOperationId: "ref",
      reason: null,
      kind: "media_ref",
      operation: "attach",
      resource: { mediaId, collection: "posts", documentId: docId, field: "coverImage" },
      base,
      input: {},
    };
    expect(await prepare(user, ref, { kind: "media_ref", ...ref.resource })).toMatchObject({
      requiredScopes: ["content:draft", "media:read", "media:write"],
    });
    expect(await db.select().from(npSettings).where(eq(npSettings.key, "seo"))).toHaveLength(0);
    expect((await db.select().from(npNavigation))[0]?.items).toEqual([]);
  });
});
