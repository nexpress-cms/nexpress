import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import {
  npMedia,
  npMediaRefs,
  npNavigation,
  npSettings,
  npRevisions,
  type NpAuthUser,
} from "@nexpress/core";

import { createAgentChangeSetApplyResourceServiceV1 } from "../../../packages/core/src/agent/changeset-apply-resources.js";

import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";

import { createAgentChangeSetResourceServiceV1 } from "../../../packages/core/src/agent/changeset-resources.js";

import {
  saveDocument,
  npGetPersistedCollectionDocumentById,
  withDeferredPostCommit,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";

import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";

import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";

import {
  getActiveTheme,
  getRegisteredThemes,
  registerThemes,
} from "../../../packages/core/src/themes/registry.js";

import { defaultTheme } from "../../../packages/themes/default/src/index.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetProposalOperationCanonicalV1,
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

const validation = createAgentChangeSetValidationResourceServiceV1();
const applyResources = createAgentChangeSetApplyResourceServiceV1();
const originalThemes = getRegisteredThemes();
const placeholder = { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` };
const content = (title = "Apply fixture") => ({ title, content: npCreateEmptyRichTextContent() });
async function actor() {
  const user = await seedUser();
  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    tokenVersion: 1,
  };
}
function entry(
  operation: NpAgentChangeSetOperationInput,
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1,
  ordinal = 1,
): NpAgentChangeSetProposalOperationCanonicalV1 {
  return { ordinal, operation, canonicalResourceKey };
}
function create(id: string) {
  return entry(
    {
      clientOperationId: "create",
      reason: null,
      kind: "document",
      operation: "create",
      resource: { collection: "posts", documentId: null },
      base: null,
      input: { document: content(), targetStatus: "draft" },
    },
    { kind: "document", collection: "posts", documentId: id },
  );
}
function update(id: string, patch: Record<string, string | null> = { title: "Applied title" }) {
  return entry(
    {
      clientOperationId: "update",
      reason: null,
      kind: "document",
      operation: "update",
      resource: { collection: "posts", documentId: id },
      base: placeholder,
      input: { patch, targetStatus: null },
    },
    { kind: "document", collection: "posts", documentId: id },
  );
}
function media(id: string, mediaId: string, operation: "attach" | "detach", ordinal: number) {
  const resource = { collection: "posts", documentId: id, field: "coverImage", mediaId };
  return entry(
    {
      clientOperationId: "media",
      reason: null,
      kind: "media_ref",
      operation,
      resource,
      base: placeholder,
      input: {},
    },
    { kind: "media_ref", ...resource },
    ordinal,
  );
}
async function seal(
  user: NpAuthUser,
  changeSetId: string,
  entries: NpAgentChangeSetProposalOperationCanonicalV1[],
) {
  return (await getTestDb()).transaction(
    async (transaction) => {
      const tx = transaction as unknown as NpTransaction;
      const operations = [];
      for (const proposed of entries) {
        const base = await validation.readBase({
          tx,
          user,
          changeSetId,
          siteId: "default",
          ...proposed,
        });
        operations.push({
          ...proposed,
          operation: { ...proposed.operation, base: base.base },
        });
      }
      return validation.validate({
        tx,
        user,
        changeSetId,
        siteId: "default",
        now: new Date(),
        operations,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
async function addMedia() {
  const [row] = await (
    await getTestDb()
  )
    .insert(npMedia)
    .values({
      siteId: "default",
      filename: "fixture.png",
      originalFilename: "fixture.png",
      mimeType: "image/png",
      filesize: 1,
      storageKey: "fixture-object",
      hash: "fixture-hash",
      status: "ready",
    })
    .returning({ id: npMedia.id });
  return row.id;
}
async function apply(
  user: NpAuthUser,
  changeSetId: string,
  plan: Awaited<ReturnType<typeof seal>>,
) {
  const db = await getTestDb();
  return withDeferredPostCommit(() =>
    db.transaction(
      (tx) =>
        applyResources.apply({
          tx: tx as unknown as NpTransaction,
          user,
          changeSetId,
          siteId: "default",
          operations: plan.operations,
        }),
      { isolationLevel: "serializable" },
    ),
  );
}

async function rollbackPlan(
  user: NpAuthUser,
  changeSetId: string,
  plan: Awaited<ReturnType<typeof seal>>,
  applied: Awaited<ReturnType<typeof apply>>,
) {
  return (await getTestDb()).transaction((tx) =>
    applyResources.prepareRollback({
      tx: tx as unknown as NpTransaction,
      user,
      siteId: "default",
      changeSetId,
      operations: plan.operations,
      beforeSnapshots: plan.snapshots,
      appliedResources: applied.operations,
    }),
  );
}
async function rollback(
  user: NpAuthUser,
  changeSetId: string,
  plan: Awaited<ReturnType<typeof seal>>,
  prepared: Awaited<ReturnType<typeof rollbackPlan>>,
) {
  return withDeferredPostCommit(async () =>
    (await getTestDb()).transaction(
      (tx) =>
        applyResources.applyRollback({
          tx: tx as unknown as NpTransaction,
          user,
          siteId: "default",
          changeSetId,
          operations: prepared.operations,
          beforeSnapshots: plan.snapshots,
        }),
      { isolationLevel: "serializable" },
    ),
  );
}

describe.skipIf(skipIfNoTestDb())("ChangeSet atomic existing-domain apply", () => {
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

  it("applies all five kinds, preserves reserved ids, and hashes final stored hook output", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      id = randomUUID(),
      db = await getTestDb();
    const owner = await saveDocument("posts", null, content("Media owner"), user, {
      status: "draft",
    });
    const mediaId = await addMedia();
    await db.insert(npNavigation).values({ siteId: "default", location: "main", items: [] });
    const themeId = (await getActiveTheme())!.manifest.id;
    const plan = await seal(user, changeSetId, [
      create(id),
      entry(
        {
          clientOperationId: "nav",
          reason: null,
          kind: "navigation",
          operation: "replace",
          resource: { location: "main" },
          base: placeholder,
          input: { items: [{ id: "docs", type: "link", label: "Docs", url: "/docs" }] },
        },
        { kind: "navigation", location: "main" },
        2,
      ),
      entry(
        {
          clientOperationId: "theme",
          reason: null,
          kind: "theme_tokens",
          operation: "replace",
          resource: { themeId },
          base: placeholder,
          input: { tokens: {} },
        },
        { kind: "theme_tokens", themeId },
        3,
      ),
      entry(
        {
          clientOperationId: "seo",
          reason: null,
          kind: "setting",
          operation: "replace",
          resource: { key: "seo" },
          base: null,
          input: { value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en" } },
        },
        { kind: "setting", key: "seo" },
        4,
      ),
      media(String(owner.doc.id), mediaId, "attach", 5),
    ]);
    const config = getCollectionConfig("posts");
    const after = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      hooks: {
        ...config.hooks,
        beforeCreate: [({ data }) => Promise.resolve({ ...data, title: "Hook normalized" })],
        afterCreate: [after],
      },
    });
    const result = await apply(user, changeSetId, plan);
    expect(result.operations).toHaveLength(5);
    expect(after).toHaveBeenCalledOnce();
    const doc = await npGetPersistedCollectionDocumentById("posts", id, "default");
    expect(doc).toMatchObject({ id, title: "Hook normalized", status: "draft" });
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      1,
    );
    expect((await db.select().from(npNavigation))[0]?.items).toEqual([
      { id: "docs", type: "link", label: "Docs", url: "/docs" },
    ]);
    expect(
      await db.select().from(npMediaRefs).where(eq(npMediaRefs.mediaId, mediaId)),
    ).toHaveLength(1);
    expect(
      (await db.select().from(npSettings).where(eq(npSettings.key, "theme")))[0]?.value,
    ).toEqual({});
    await db.transaction(async (tx) => {
      for (const [index, operation] of plan.operations.entries()) {
        const current = await validation.readCurrent({
          tx: tx as unknown as NpTransaction,
          user,
          siteId: "default",
          changeSetId,
          ...operation,
        });
        expect(result.operations[index]?.afterHash).toBe(current.beforeHash);
        expect(result.operations[index]?.snapshotHash).toBe(current.snapshotHash);
      }
    });
    await expect(
      createAgentChangeSetResourceServiceV1().assertVisible({
        user,
        siteId: "default",
        ...plan.operations[0],
        currentResource: true,
      }),
    ).resolves.toEqual(["content:draft", "content:read"]);
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      access: { read: () => false },
    });
    await expect(
      createAgentChangeSetResourceServiceV1().assertVisible({
        user,
        siteId: "default",
        ...plan.operations[0],
        currentResource: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rolls back earlier writes, revisions and queued hooks on a late contradiction", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      mediaId = await addMedia();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      db = await getTestDb();
    const plan = await seal(user, changeSetId, [
      update(id, { coverImage: mediaId }),
      media(id, mediaId, "detach", 2),
    ]);
    const config = getCollectionConfig("posts"),
      hook = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      hooks: { ...config.hooks, afterUpdate: [hook] },
    });
    await expect(apply(user, changeSetId, plan)).rejects.toMatchObject({
      code: "CHANGESET_BASE_CONFLICT",
    });
    expect(hook).not.toHaveBeenCalled();
    expect(
      (await npGetPersistedCollectionDocumentById("posts", id, "default"))?.coverImage,
    ).toBeNull();
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      1,
    );
    expect(await db.select().from(npMediaRefs)).toHaveLength(0);
  });

  it("accepts consistent document/media overlap and rejects stale bases before mutation", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      mediaId = await addMedia();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const plan = await seal(user, changeSetId, [
      update(id, { coverImage: mediaId }),
      media(id, mediaId, "attach", 2),
    ]);
    const result = await apply(user, changeSetId, plan);
    expect(result.operations).toHaveLength(2);
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.coverImage).toBe(
      mediaId,
    );
    await expect(apply(user, changeSetId, plan)).rejects.toMatchObject({
      code: "CHANGESET_BASE_CONFLICT",
    });
    expect(
      await (await getTestDb()).select().from(npRevisions).where(eq(npRevisions.documentId, id)),
    ).toHaveLength(2);
  });

  it("removes SEO through its domain seam and records verified absence", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb();
    await db.insert(npSettings).values({
      siteId: "default",
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en" },
    });
    const plan = await seal(user, changeSetId, [
      entry(
        {
          clientOperationId: "remove",
          reason: null,
          kind: "setting",
          operation: "remove",
          resource: { key: "seo" },
          base: placeholder,
          input: {},
        },
        { kind: "setting", key: "seo" },
      ),
    ]);
    const result = await apply(user, changeSetId, plan);
    expect(result.operations[0]?.snapshot).toMatchObject({
      presence: "absent",
      base: null,
      value: null,
    });
    expect(
      await db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, "default"), eq(npSettings.key, "seo"))),
    ).toHaveLength(0);
  });

  it("uses the normal pipeline for publish, archive and scheduled document transitions", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      publishAt = new Date(Date.now() + 3_600_000).toISOString();
    for (const operation of ["publish", "archive", "schedule"] as const) {
      const proposed = entry(
        {
          clientOperationId: operation,
          reason: null,
          kind: "document",
          operation,
          resource: { collection: "posts", documentId: id },
          base: placeholder,
          input: operation === "schedule" ? { publishAt } : {},
        } as NpAgentChangeSetOperationInput,
        { kind: "document", collection: "posts", documentId: id },
      );
      await apply(user, changeSetId, await seal(user, changeSetId, [proposed]));
      const current = await npGetPersistedCollectionDocumentById("posts", id, "default");
      expect(current?.status).toBe(
        operation === "publish" ? "published" : operation === "archive" ? "archived" : "scheduled",
      );
      if (operation === "schedule") expect(current?.publishedAt).toEqual(new Date(publishAt));
    }
    expect(
      await (await getTestDb()).select().from(npRevisions).where(eq(npRevisions.documentId, id)),
    ).toHaveLength(4);
  });

  it("rechecks live item write authority before creating any revision", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      plan = await seal(user, changeSetId, [update(id)]);
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      access: { ...config.access, update: () => false },
    });
    await expect(apply(user, changeSetId, plan)).rejects.toMatchObject({
      code: "CHANGESET_ACCESS_DENIED",
    });
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.title).toBe(
      "Apply fixture",
    );
    expect(
      await (await getTestDb()).select().from(npRevisions).where(eq(npRevisions.documentId, id)),
    ).toHaveLength(1);
  });

  it("rechecks a media owner's item authority after an earlier operation changes that owner", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      mediaId = await addMedia();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      access: { ...config.access, update: ({ doc }) => doc?.title !== "Locked" },
    });
    const plan = await seal(user, changeSetId, [
      update(id, { title: "Locked", coverImage: mediaId }),
      media(id, mediaId, "attach", 2),
    ]);
    await expect(apply(user, changeSetId, plan)).rejects.toMatchObject({
      code: "CHANGESET_ACCESS_DENIED",
    });
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.title).toBe(
      "Apply fixture",
    );
    expect(await (await getTestDb()).select().from(npMediaRefs)).toHaveLength(0);
  });
  it("compensates all five kinds while preserving the created row and deleting absent overrides", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      id = randomUUID(),
      db = await getTestDb();
    const owner = await saveDocument("posts", null, content("Owner"), user, { status: "draft" });
    const mediaId = await addMedia();
    await db.insert(npNavigation).values({ siteId: "default", location: "main", items: [] });
    const themeId = (await getActiveTheme())!.manifest.id;
    const plan = await seal(user, changeSetId, [
      create(id),
      entry(
        {
          clientOperationId: "navigation",
          reason: null,
          kind: "navigation",
          operation: "replace",
          resource: { location: "main" },
          base: placeholder,
          input: { items: [{ id: "changed", type: "link", label: "Changed", url: "/changed" }] },
        },
        { kind: "navigation", location: "main" },
        2,
      ),
      entry(
        {
          clientOperationId: "theme",
          reason: null,
          kind: "theme_tokens",
          operation: "replace",
          resource: { themeId },
          base: placeholder,
          input: { tokens: {} },
        },
        { kind: "theme_tokens", themeId },
        3,
      ),
      entry(
        {
          clientOperationId: "seo",
          reason: null,
          kind: "setting",
          operation: "replace",
          resource: { key: "seo" },
          base: null,
          input: { value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en" } },
        },
        { kind: "setting", key: "seo" },
        4,
      ),
      media(String(owner.doc.id), mediaId, "attach", 5),
    ]);
    const applied = await apply(user, changeSetId, plan);
    const prepared = await rollbackPlan(user, changeSetId, plan, applied);
    expect(prepared.risk).toMatchObject({ reversible: false, reasonCodes: ["ROLLBACK_PARTIAL"] });
    const restored = await rollback(user, changeSetId, plan, prepared);
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.status).toBe(
      "archived",
    );
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      2,
    );
    expect((await db.select().from(npNavigation))[0].items).toEqual([]);
    expect(await db.select().from(npSettings)).toHaveLength(0);
    expect(await db.select().from(npMediaRefs)).toHaveLength(0);
    expect(restored.operations.map((o) => o.afterHash)).toEqual(
      prepared.operations.map((o) => o.proposedAfterHash),
    );
    await expect(rollback(user, changeSetId, plan, prepared)).rejects.toMatchObject({
      code: "CHANGESET_BASE_CONFLICT",
    });
  });
  it.each(["draft", "published", "archived", "scheduled", "pending"] as const)(
    "restores full document content and prior %s state through a new revision",
    async (status) => {
      const user = await actor(),
        changeSetId = randomUUID(),
        db = await getTestDb();
      const publishedAt = status === "scheduled" ? new Date(Date.now() + 3_600_000) : null;
      const before = await saveDocument(
        "posts",
        null,
        { ...content("Before"), publishedAt },
        user,
        { status },
      );
      const id = String(before.doc.id);
      const proposed = update(id);
      if (proposed.operation.kind !== "document" || proposed.operation.operation !== "update")
        throw new Error("Invalid fixture");
      proposed.operation.input = {
        patch: { title: "After" },
        targetStatus: "draft",
      };
      const plan = await seal(user, changeSetId, [proposed]);
      const applied = await apply(user, changeSetId, plan);
      const prepared = await rollbackPlan(user, changeSetId, plan, applied);
      const restored = await rollback(user, changeSetId, plan, prepared);
      expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toMatchObject({
        title: "Before",
        status,
        publishedAt,
      });
      expect(
        await db.select().from(npRevisions).where(eq(npRevisions.documentId, id)),
      ).toHaveLength(3);
      expect(restored.operations[0].afterHash).toBe(plan.operations[0].beforeHash);
    },
  );
  it("restores explicit schedule absence, removed SEO and a detached active media relation", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb(),
      mediaId = await addMedia();
    const owner = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(owner.doc.id);
    await db.insert(npMediaRefs).values({
      siteId: "default",
      collection: "posts",
      documentId: id,
      field: "coverImage",
      mediaId,
    });
    const value = { defaultOgImage: null, twitterHandle: "before", defaultLocale: "en" };
    await db.insert(npSettings).values({ siteId: "default", key: "seo", value });
    const plan = await seal(user, changeSetId, [
      entry(
        {
          clientOperationId: "schedule",
          reason: null,
          kind: "document",
          operation: "schedule",
          resource: { collection: "posts", documentId: id },
          base: placeholder,
          input: { publishAt: new Date(Date.now() + 3_600_000).toISOString() },
        },
        { kind: "document", collection: "posts", documentId: id },
      ),
      entry(
        {
          clientOperationId: "remove",
          reason: null,
          kind: "setting",
          operation: "remove",
          resource: { key: "seo" },
          base: placeholder,
          input: {},
        },
        { kind: "setting", key: "seo" },
        2,
      ),
    ]);
    const applied = await apply(user, changeSetId, plan),
      prepared = await rollbackPlan(user, changeSetId, plan, applied);
    await rollback(user, changeSetId, plan, prepared);
    expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toMatchObject({
      status: "draft",
      publishedAt: null,
    });
    expect((await db.select().from(npSettings))[0].value).toEqual(value);
    // Standalone media relation compensations preserve relation-only semantics.
    await db
      .insert(npMediaRefs)
      .values({
        siteId: "default",
        collection: "posts",
        documentId: id,
        field: "coverImage",
        mediaId,
      })
      .onConflictDoNothing();
    const mediaPlan = await seal(user, randomUUID(), [media(id, mediaId, "detach", 1)]);
    const mediaChangeSetId = mediaPlan.snapshots[0].changeSetId;
    const mediaApplied = await apply(user, mediaChangeSetId, mediaPlan);
    const mediaPrepared = await rollbackPlan(user, mediaChangeSetId, mediaPlan, mediaApplied);
    await rollback(user, mediaChangeSetId, mediaPlan, mediaPrepared);
    expect(await db.select().from(npMediaRefs)).toHaveLength(1);
  });
  it("fences later edits, tampered snapshots and current write authority before compensation", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const plan = await seal(user, changeSetId, [update(id)]),
      applied = await apply(user, changeSetId, plan),
      prepared = await rollbackPlan(user, changeSetId, plan, applied);
    const tampered = {
      ...plan,
      snapshots: plan.snapshots.map((s) => ({
        ...s,
        value: { ...(s.value as Record<string, never>), title: "Tampered" },
      })),
    };
    await expect(rollback(user, changeSetId, tampered, prepared)).rejects.toMatchObject({
      code: "CHANGESET_ROLLBACK_UNAVAILABLE",
    });
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      access: { ...config.access, update: () => false },
    });
    await expect(rollback(user, changeSetId, plan, prepared)).rejects.toMatchObject({
      code: "CHANGESET_ACCESS_DENIED",
    });
    registerCollection("posts", getCollectionTable("posts"), config);
    await saveDocument("posts", id, { title: "Later" }, user);
    await expect(rollbackPlan(user, changeSetId, plan, applied)).rejects.toMatchObject({
      code: "CHANGESET_BASE_CONFLICT",
    });
    await expect(rollback(user, changeSetId, plan, prepared)).rejects.toMatchObject({
      code: "CHANGESET_BASE_CONFLICT",
    });
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.title).toBe(
      "Later",
    );
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      3,
    );
  });
  it("restores retained hidden fields and rejects a newly incompatible prior schema", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument(
      "posts",
      null,
      { ...content("Long prior title"), excerpt: "Private prior" },
      user,
      { status: "draft" },
    );
    const id = String(saved.doc.id),
      config = getCollectionConfig("posts");
    const fields = config.fields.map((field) =>
      "name" in field && field.name === "excerpt" ? { ...field, hidden: true } : field,
    );
    registerCollection("posts", getCollectionTable("posts"), { ...config, fields });
    const plan = await seal(user, changeSetId, [update(id, { title: "After" })]);
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      fields,
      hooks: {
        ...config.hooks,
        beforeUpdate: [({ data }) => Promise.resolve({ ...data, excerpt: "Private after" })],
      },
    });
    const applied = await apply(user, changeSetId, plan);
    registerCollection("posts", getCollectionTable("posts"), { ...config, fields });
    const prepared = await rollbackPlan(user, changeSetId, plan, applied);
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      fields: fields.map((field) =>
        "name" in field && field.name === "title" && field.type === "text"
          ? { ...field, maxLength: 6 }
          : field,
      ),
    });
    await expect(rollback(user, changeSetId, plan, prepared)).rejects.toMatchObject({
      code: "CHANGESET_SCHEMA_INVALID",
    });
    registerCollection("posts", getCollectionTable("posts"), { ...config, fields });
    await rollback(user, changeSetId, plan, prepared);
    expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toMatchObject({
      title: "Long prior title",
      excerpt: "Private prior",
    });
  });
  it("restores an overlapping document and media index only after all compensation writes", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      mediaId = await addMedia();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const plan = await seal(user, changeSetId, [
        update(id, { coverImage: mediaId }),
        media(id, mediaId, "attach", 2),
      ]),
      applied = await apply(user, changeSetId, plan),
      prepared = await rollbackPlan(user, changeSetId, plan, applied);
    const result = await rollback(user, changeSetId, plan, prepared);
    expect(
      (await npGetPersistedCollectionDocumentById("posts", id, "default"))?.coverImage,
    ).toBeNull();
    expect(await (await getTestDb()).select().from(npMediaRefs)).toHaveLength(0);
    expect(result.operations.map((o) => o.afterHash)).toEqual(
      prepared.operations.map((o) => o.proposedAfterHash),
    );
  });
  it("rejects missing media and equal-content newer document revisions without any compensation", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      mediaId = await addMedia(),
      db = await getTestDb();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    await db.insert(npMediaRefs).values({
      siteId: "default",
      collection: "posts",
      documentId: id,
      field: "coverImage",
      mediaId,
    });
    const plan = await seal(user, changeSetId, [media(id, mediaId, "detach", 1)]),
      applied = await apply(user, changeSetId, plan);
    await db.update(npMedia).set({ deletedAt: new Date() }).where(eq(npMedia.id, mediaId));
    await expect(rollbackPlan(user, changeSetId, plan, applied)).rejects.toThrow();
    expect(await db.select().from(npMediaRefs)).toHaveLength(0);
    const documentId = randomUUID();
    const proposed = create(documentId);
    if (proposed.operation.kind !== "document" || proposed.operation.operation !== "create")
      throw new Error("Invalid fixture");
    proposed.operation.input.document.title = "Second document";
    const documentPlan = await seal(user, randomUUID(), [proposed]),
      changeSet2 = documentPlan.snapshots[0].changeSetId;
    const documentApplied = await apply(user, changeSet2, documentPlan);
    await saveDocument("posts", documentId, {}, user);
    await expect(
      rollbackPlan(user, changeSet2, documentPlan, documentApplied),
    ).rejects.toMatchObject({ code: "CHANGESET_BASE_CONFLICT" });
    expect(
      (await npGetPersistedCollectionDocumentById("posts", documentId, "default"))?.status,
    ).toBe("draft");
  });
  it("restores a present empty theme override without confusing it with absence", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb(),
      themeId = (await getActiveTheme())!.manifest.id;
    await db.insert(npSettings).values({ siteId: "default", key: "theme", value: {} });
    const plan = await seal(user, changeSetId, [
      entry(
        {
          clientOperationId: "theme",
          reason: null,
          kind: "theme_tokens",
          operation: "replace",
          resource: { themeId },
          base: placeholder,
          input: { tokens: { colors: { primary: "#123456" } } },
        },
        { kind: "theme_tokens", themeId },
      ),
    ]);
    const applied = await apply(user, changeSetId, plan),
      prepared = await rollbackPlan(user, changeSetId, plan, applied),
      result = await rollback(user, changeSetId, plan, prepared);
    expect((await db.select().from(npSettings))[0].value).toEqual({});
    expect(result.operations[0].snapshot.presence).toBe("present");
    expect(result.operations[0].afterHash).toBe(plan.operations[0].beforeHash);
  });
  it("retains every prior revision during compensation even at the normal revision cap", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb(),
      config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      versions: { ...(typeof config.versions === "object" ? config.versions : {}), max: 2 },
    });
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      plan = await seal(user, changeSetId, [update(id)]),
      applied = await apply(user, changeSetId, plan);
    const before = await db.select().from(npRevisions).where(eq(npRevisions.documentId, id));
    expect(before).toHaveLength(2);
    await rollback(user, changeSetId, plan, await rollbackPlan(user, changeSetId, plan, applied));
    const after = await db.select().from(npRevisions).where(eq(npRevisions.documentId, id));
    expect(after).toHaveLength(3);
    expect(after).toEqual(expect.arrayContaining(before));
    await saveDocument("posts", id, { title: "Ordinary later update" }, user);
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      2,
    );
  });
});
