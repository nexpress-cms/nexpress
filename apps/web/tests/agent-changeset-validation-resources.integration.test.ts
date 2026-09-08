import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import {
  createSite,
  npMedia,
  npMediaRefs,
  npNavigation,
  npSettings,
  npRevisions,
  type NpAuthUser,
} from "@nexpress/core";
// eslint-disable-next-line import-x/no-relative-packages
import { createAgentChangeSetValidationResourceServiceV1 } from "../../../packages/core/src/agent/changeset-validation-resources.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  saveDocument,
  npGetPersistedCollectionDocumentById,
  type NpTransaction,
} from "../../../packages/core/src/collections/pipeline.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getCollectionConfig,
  getCollectionTable,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  getActiveTheme,
  getRegisteredThemes,
  registerThemes,
} from "../../../packages/core/src/themes/registry.js";
// eslint-disable-next-line import-x/no-relative-packages
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
// eslint-disable-next-line import-x/no-relative-packages
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
const service = createAgentChangeSetValidationResourceServiceV1();
const originalThemes = getRegisteredThemes();
const now = new Date("2026-09-08T00:00:00Z");
const placeholder = { version: "pending", digest: `cj1:sha256:${"A".repeat(43)}` };
const content = (title = "Draft post") => ({ title, content: npCreateEmptyRichTextContent() });
async function actor() {
  const user = await seedUser();
  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    tokenVersion: 1,
  } as NpAuthUser;
}
function entry(
  operation: NpAgentChangeSetOperationInput,
  canonicalResourceKey: NpAgentChangeSetResourceKeyV1,
  ordinal = 1,
): NpAgentChangeSetProposalOperationCanonicalV1 {
  return { ordinal, operation, canonicalResourceKey };
}
function update(id: string, title = "Next title") {
  return entry(
    {
      clientOperationId: "update",
      reason: null,
      kind: "document",
      operation: "update",
      resource: { collection: "posts", documentId: id },
      base: placeholder,
      input: { patch: { title }, targetStatus: null },
    },
    { kind: "document", collection: "posts", documentId: id },
  );
}
function create(id: string, title = "New draft", ordinal = 1) {
  return entry(
    {
      clientOperationId: `create-${ordinal.toString()}`,
      reason: null,
      kind: "document",
      operation: "create",
      resource: { collection: "posts", documentId: null },
      base: null,
      input: { document: content(title), targetStatus: "draft" },
    },
    { kind: "document", collection: "posts", documentId: id },
    ordinal,
  );
}
async function bind(
  tx: NpTransaction,
  user: NpAuthUser,
  changeSetId: string,
  operation: NpAgentChangeSetProposalOperationCanonicalV1,
) {
  const current = await service.readBase({
    tx,
    user,
    siteId: "default",
    changeSetId,
    ...operation,
  });
  return {
    ...operation,
    operation: { ...operation.operation, base: current.base },
  } as NpAgentChangeSetProposalOperationCanonicalV1;
}
async function read(
  user: NpAuthUser,
  changeSetId: string,
  operation: NpAgentChangeSetProposalOperationCanonicalV1,
) {
  return (await getTestDb()).transaction(
    (tx) =>
      service.readBase({
        tx: tx as unknown as NpTransaction,
        user,
        siteId: "default",
        changeSetId,
        ...operation,
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
async function validate(
  user: NpAuthUser,
  changeSetId: string,
  operations: NpAgentChangeSetProposalOperationCanonicalV1[],
) {
  return (await getTestDb()).transaction(
    (tx) =>
      service.validate({
        tx: tx as unknown as NpTransaction,
        user,
        siteId: "default",
        changeSetId,
        now,
        operations,
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
async function addMedia(siteId = "default") {
  const [row] = await (
    await getTestDb()
  )
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
describe.skipIf(skipIfNoTestDb())("ChangeSet consistent-transaction resource validation", () => {
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
  it("rejects status-only publication when the live schema no longer accepts the persisted document", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const operation = entry(
      {
        clientOperationId: "publish",
        reason: null,
        kind: "document",
        operation: "publish",
        resource: { collection: "posts", documentId: id },
        base: placeholder,
        input: {},
      },
      { kind: "document", collection: "posts", documentId: id },
    );
    operation.operation.base = (await read(user, changeSetId, operation)).base;
    const config = getCollectionConfig("posts");
    registerCollection("posts", getCollectionTable("posts"), {
      ...config,
      fields: config.fields.map((field) =>
        "name" in field && field.name === "title" && field.type === "text"
          ? { ...field, maxLength: 1 }
          : field,
      ),
    });
    await expect(validate(user, changeSetId, [operation])).rejects.toMatchObject({
      issues: [{ code: "RESOURCE_NOT_FOUND" }],
    });
    registerCollection("posts", getCollectionTable("posts"), config);
    const persisted = await npGetPersistedCollectionDocumentById("posts", id, "default");
    expect(persisted?.status).toBe("draft");
    expect(persisted?.title).toBe(saved.doc.title);
  });
  it("validates create absence without documents, revisions or media reference writes", async () => {
    const user = await actor(),
      id = randomUUID(),
      changeSetId = randomUUID();
    const result = await validate(user, changeSetId, [create(id)]);
    expect(result.snapshots).toMatchObject([{ presence: "absent", base: null, value: null }]);
    expect(result.risk).toMatchObject({
      level: "high",
      approvalMode: "human",
      reversible: false,
      reasonCodes: ["ROLLBACK_PARTIAL"],
    });
    expect(result.requiredScopes).toEqual(["content:read"]);
    expect(result.requiredApplyScopes).toEqual(["content:draft", "content:publish"]);
    expect(await npGetPersistedCollectionDocumentById("posts", id, "default")).toBeNull();
    const db = await getTestDb();
    expect(await db.select().from(npRevisions)).toHaveLength(0);
    expect(await db.select().from(npMediaRefs)).toHaveLength(0);
    expect(await validate(user, changeSetId, [create(id)])).toEqual(result);
  });
  it("uses one PostgreSQL snapshot for row, revision head and canonical bases", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      operation = update(id),
      db = await getTestDb();
    const before = await db.transaction(
      async (tx) => {
        const context = {
          tx: tx as unknown as NpTransaction,
          siteId: "default",
          user,
          changeSetId,
          ...operation,
        };
        const first = await service.readBase(context);
        await saveDocument("posts", id, { title: "Concurrent edit" }, user, { status: "draft" });
        expect(await service.readBase(context)).toEqual(first);
        return first;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    const after = await read(user, changeSetId, operation);
    expect(after.base).not.toEqual(before.base);
    expect(after.snapshotHash).not.toEqual(before.snapshotHash);
    expect(before.base?.version).toMatch(/^revision:/);
    await expect(
      validate(user, changeSetId, [
        {
          ...operation,
          operation: { ...operation.operation, base: before.base },
        } as NpAgentChangeSetProposalOperationCanonicalV1,
      ]),
    ).rejects.toMatchObject({ issues: [{ code: "BASE_CONFLICT" }] });
  });
  it("records semantic hashes separately from full metadata evidence and rechecks live item boundaries", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      operation = update(id),
      db = await getTestDb();
    const before = await read(user, changeSetId, operation);
    const table = getCollectionTable(
      "posts",
    ) as typeof import("../src/db/generated/collections.js").postsTable;
    await db
      .update(table)
      .set({ updatedAt: new Date(Date.now() + 1000) })
      .where(eq(table.id, id));
    const after = await read(user, changeSetId, operation);
    expect(after.beforeHash).toBe(before.beforeHash);
    expect(after.base?.version).not.toBe(before.base?.version);
    expect(after.snapshotHash).not.toBe(before.snapshotHash);
    const config = getCollectionConfig("posts");
    registerCollection("posts", table, {
      ...config,
      fields: config.fields.map((field) =>
        "name" in field && field.name === "title" ? { ...field, hidden: true } : field,
      ),
    });
    await expect(read(user, changeSetId, operation)).rejects.toMatchObject({
      issues: [{ code: "SCHEMA_INVALID" }],
    });
    registerCollection("posts", table, { ...config, access: { read: () => false } });
    await expect(read(user, changeSetId, operation)).rejects.toMatchObject({
      issues: [{ code: "RESOURCE_NOT_FOUND" }],
    });
  });
  it("seals all five resource kinds, including explicit absent SEO and theme overrides, without domain writes", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id),
      mediaId = await addMedia();
    await db.insert(npNavigation).values({ siteId: "default", location: "main", items: [] });
    const theme = (await getActiveTheme())!.manifest.id;
    const inputs = [
      update(id),
      entry(
        {
          clientOperationId: "nav",
          reason: null,
          kind: "navigation",
          operation: "replace",
          resource: { location: "main" },
          base: placeholder,
          input: { items: [] },
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
          resource: { themeId: theme },
          base: placeholder,
          input: { tokens: {} },
        },
        { kind: "theme_tokens", themeId: theme },
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
      entry(
        {
          clientOperationId: "media",
          reason: null,
          kind: "media_ref",
          operation: "attach",
          resource: { collection: "posts", documentId: id, field: "coverImage", mediaId },
          base: placeholder,
          input: {},
        },
        { kind: "media_ref", collection: "posts", documentId: id, field: "coverImage", mediaId },
        5,
      ),
    ];
    const result = await db.transaction(
      async (tx) => {
        const operations = [];
        for (const operation of inputs)
          operations.push(await bind(tx as unknown as NpTransaction, user, changeSetId, operation));
        return service.validate({
          tx: tx as unknown as NpTransaction,
          siteId: "default",
          user,
          changeSetId,
          now,
          operations,
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    expect(result.operations).toHaveLength(5);
    expect(result.snapshots.map((snapshot) => snapshot.presence)).toEqual([
      "present",
      "present",
      "absent",
      "absent",
      "present",
    ]);
    expect(result.operations[2]!.beforeHash).toMatch(/^cj1:sha256:/);
    expect(result.operations[3]!.beforeHash).toMatch(/^cj1:sha256:/);
    expect(JSON.stringify(result.snapshots)).not.toContain("fixture-object");
    expect(
      await db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, "default"), eq(npSettings.key, "seo"))),
    ).toHaveLength(0);
    expect(await db.select().from(npMediaRefs)).toHaveLength(0);
    expect((await npGetPersistedCollectionDocumentById("posts", id, "default"))?.title).toBe(
      "Draft post",
    );
  });
  it("rejects cross-site targets and media state changes before preserving evidence", async () => {
    const user = await actor(),
      changeSetId = randomUUID();
    await createSite({ id: "validation-other", name: "Other" });
    const foreign = await withCurrentSite("validation-other", () =>
      saveDocument("posts", null, content(), user, { status: "draft" }),
    );
    await expect(read(user, changeSetId, update(String(foreign.doc.id)))).rejects.toMatchObject({
      issues: [{ code: "RESOURCE_NOT_FOUND" }],
    });
    const mediaId = await addMedia();
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" });
    const id = String(saved.doc.id);
    const resource = {
      kind: "media_ref" as const,
      collection: "posts",
      documentId: id,
      field: "coverImage",
      mediaId,
    };
    const op = entry(
      {
        clientOperationId: "media",
        reason: null,
        kind: "media_ref",
        operation: "detach",
        resource: { collection: "posts", documentId: id, field: "coverImage", mediaId },
        base: placeholder,
        input: {},
      },
      resource,
    );
    await (
      await getTestDb()
    )
      .update(npMedia)
      .set({ status: "error" })
      .where(eq(npMedia.id, mediaId));
    await expect(read(user, changeSetId, op)).rejects.toMatchObject({
      issues: [{ code: "REFERENCE_INVALID" }],
    });
  });
  it("detects explicit absence and relation changes and checks the complete projected create quota", async () => {
    const user = await actor(),
      changeSetId = randomUUID(),
      db = await getTestDb();
    const seo = entry(
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
    );
    expect((await read(user, changeSetId, seo)).snapshot.presence).toBe("absent");
    await db.insert(npSettings).values({
      siteId: "default",
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en" },
    });
    await expect(validate(user, changeSetId, [seo])).rejects.toMatchObject({
      issues: [{ code: "BASE_CONFLICT" }],
    });
    const saved = await saveDocument("posts", null, content(), user, { status: "draft" }),
      id = String(saved.doc.id),
      mediaId = await addMedia();
    const resource = { collection: "posts", documentId: id, field: "coverImage", mediaId };
    const op = entry(
      {
        clientOperationId: "media",
        reason: null,
        kind: "media_ref",
        operation: "attach",
        resource,
        base: placeholder,
        input: {},
      },
      { kind: "media_ref", ...resource },
    );
    const before = await read(user, changeSetId, op);
    await db.insert(npMediaRefs).values({ siteId: "default", ...resource });
    const after = await read(user, changeSetId, op);
    expect(after.base?.version).toBe(before.base?.version);
    expect(after.base?.digest).not.toBe(before.base?.digest);
    await db.insert(npSettings).values({
      siteId: "default",
      key: "site.quotas",
      value: { documents: 2, storageBytes: null, jobEnqueuesPerHour: null },
    });
    await expect(
      validate(user, changeSetId, [create(randomUUID(), "One", 1), create(randomUUID(), "Two", 2)]),
    ).rejects.toMatchObject({ issues: [{ code: "QUOTA_EXCEEDED" }] });
  });
});
