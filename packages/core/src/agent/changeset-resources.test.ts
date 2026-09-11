import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpAuthUser, NpCollectionConfig } from "../config/types.js";
import {
  createAgentChangeSetResourceServiceV1,
  npAgentChangeSetActionTargetsV1,
} from "./changeset-resources.js";
import type {
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetResourceKeyV1,
} from "../agent-contract/types.js";
import { npGetPersistedCollectionDocumentById } from "../collections/pipeline.js";
import { getCollectionConfig } from "../collections/registry.js";
import { getActiveTheme } from "../themes/registry.js";

vi.mock("../collections/pipeline.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  npGetPersistedCollectionDocumentById: vi.fn(),
}));
vi.mock("../collections/registry.js", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getCollectionConfig: vi.fn(),
}));
vi.mock("../themes/registry.js", () => ({ getActiveTheme: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";

describe("ChangeSet action target inventory", () => {
  it("deduplicates owning document references without merging distinct resource families", () => {
    const resources: NpAgentChangeSetResourceKeyV1[] = [
      { kind: "document", collection: "posts", documentId: id },
      { kind: "media_ref", collection: "posts", documentId: id, mediaId: id, field: "coverImage" },
      { kind: "navigation", location: "primary" },
      { kind: "theme_tokens", themeId: "default" },
      { kind: "setting", key: "seo" },
    ];
    const targets = npAgentChangeSetActionTargetsV1(resources);
    expect(targets).toHaveLength(4);
    expect(targets).toContainEqual(resources[0]);
    expect(targets).toContainEqual(resources[2]);
    expect(targets).toContainEqual(resources[3]);
    expect(targets).toContainEqual(resources[4]);
    expect(npAgentChangeSetActionTargetsV1([...resources].reverse())).toEqual(targets);
    expect(resources).toHaveLength(5);
  });
});
const otherId = "22222222-2222-4222-8222-222222222222";
const user = {
  id: otherId,
  email: "fixture@example.test",
  name: "Fixture",
  role: "admin",
} as NpAuthUser;
const base = { version: "v1", digest: `cj1:sha256:${"A".repeat(43)}` };
const config: NpCollectionConfig = {
  slug: "articles",
  labels: { singular: "Article", plural: "Articles" },
  slugField: true,
  fields: [
    { name: "title", type: "text", required: true },
    { name: "when", type: "date" },
    { name: "body", type: "richText" },
    { name: "blocks", type: "blocks" },
    { name: "related", type: "relationship", relationTo: "articles" },
    { name: "internal", type: "text", hidden: true },
    {
      name: "meta",
      type: "group",
      fields: [
        { name: "locked", type: "text", admin: { readOnly: true } },
        { name: "label", type: "text", defaultValue: "Default" },
      ],
    },
  ],
};
function create(document: Record<string, unknown>): NpAgentChangeSetOperationInput {
  return {
    clientOperationId: "one",
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "articles", documentId: null },
    base: null,
    input: { document: document as never, targetStatus: "draft" },
  };
}
function prepare(
  operation: NpAgentChangeSetOperationInput,
  resource: NpAgentChangeSetResourceKeyV1 = {
    kind: "document",
    collection: "articles",
    documentId: id,
  },
) {
  return createAgentChangeSetResourceServiceV1().prepare({
    siteId: "default",
    user,
    operation,
    canonicalResourceKey: resource,
    reservedCreateDocumentIds: [id, otherId],
  });
}

describe("ChangeSet resource acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCollectionConfig).mockReturnValue(config);
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue(null);
  });
  it("reuses exact collection defaults, slug and dates without creating a document", async () => {
    const operation = create({
      title: "Crème Launch",
      when: "2026-09-01T09:00:00+09:00",
      meta: {},
    });
    const accepted = await prepare(operation);
    expect(accepted).toMatchObject({
      canonicalResourceKey: { documentId: id },
      requiredScopes: ["content:draft"],
      operation: {
        input: {
          document: {
            title: "Crème Launch",
            slug: "creme-launch",
            when: "2026-09-01T00:00:00.000Z",
            meta: { label: "Default" },
          },
        },
      },
    });
    expect(operation).toEqual(
      create({ title: "Crème Launch", when: "2026-09-01T09:00:00+09:00", meta: {} }),
    );
    expect(npGetPersistedCollectionDocumentById).toHaveBeenCalledExactlyOnceWith(
      "articles",
      id,
      "default",
      undefined,
    );
  });
  it("keeps protected defaults in ACL validation but outside editable create and update bodies", async () => {
    const acl = vi.fn((_args: { data?: unknown }) => true);
    const fields: NpCollectionConfig["fields"] = [
      ...config.fields,
      {
        type: "row",
        fields: [{ name: "server", type: "text", hidden: true, defaultValue: "server-default" }],
      },
      {
        name: "nested",
        type: "group",
        fields: [
          {
            type: "collapsible",
            label: "Details",
            fields: [
              { name: "secret", type: "text", hidden: true, defaultValue: "nested-default" },
              {
                name: "locked",
                type: "text",
                admin: { readOnly: true },
                defaultValue: "locked-default",
              },
              { name: "label", type: "text", defaultValue: "Visible" },
            ],
          },
        ],
      },
      {
        name: "rows",
        type: "array",
        fields: [
          { name: "private", type: "text", hidden: true, defaultValue: "row-default" },
          { name: "locked", type: "text", admin: { readOnly: true }, defaultValue: "locked-row" },
          { name: "label", type: "text", defaultValue: "Visible row" },
        ],
      },
    ];
    vi.mocked(getCollectionConfig).mockReturnValue({
      ...config,
      fields,
      access: { create: acl, update: acl },
    });
    const accepted = await prepare(create({ title: "Draft", nested: {}, rows: [{}] }));
    expect(accepted.operation).toMatchObject({
      input: {
        document: {
          title: "Draft",
          nested: { label: "Visible" },
          rows: [{ label: "Visible row" }],
        },
      },
    });
    expect(JSON.stringify(accepted.operation)).not.toMatch(
      /server-default|nested-default|locked-default|row-default|locked-row/,
    );
    expect(acl.mock.calls[0]?.[0]).toMatchObject({
      data: {
        server: "server-default",
        nested: { secret: "nested-default", locked: "locked-default" },
        rows: [{ private: "row-default", locked: "locked-row" }],
      },
    });
    expect(await prepare(accepted.operation)).toEqual(accepted);
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({
      id,
      siteId: "default",
      createdBy: null,
      updatedBy: null,
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: new Date("2026-09-01T00:00:00Z"),
      visibility: "public",
      slug: "original",
      title: "Original",
      status: "published",
      when: null,
      body: npCreateEmptyRichTextContent(),
      blocks: [],
      related: null,
      internal: null,
      meta: { locked: null, label: "Original" },
      server: "server-default",
      nested: { secret: "nested-default", locked: "locked-default", label: "Original" },
      rows: [],
    });
    const update: NpAgentChangeSetOperationInput = {
      clientOperationId: "update",
      reason: null,
      kind: "document",
      operation: "update",
      resource: { collection: "articles", documentId: id },
      base,
      input: { patch: { nested: {}, rows: [{}] }, targetStatus: null },
    };
    const updated = await prepare(update);
    expect(updated.operation).toMatchObject({
      input: {
        patch: {
          nested: { label: "Visible" },
          rows: [{ label: "Visible row" }],
        },
      },
    });
    expect(JSON.stringify(updated.operation)).not.toMatch(
      /server-default|nested-default|locked-default|row-default|locked-row/,
    );
    expect(await prepare(updated.operation)).toEqual(updated);
  });
  it.each([
    ["top", "hidden"],
    ["group", "hidden"],
    ["array", "hidden"],
    ["top", "readOnly"],
    ["group", "readOnly"],
    ["array", "readOnly"],
  ] as const)(
    "refuses stored %s input after the live field becomes %s",
    async (boundary, protection) => {
      const field = { name: "editable", type: "text" as const };
      const fields = (protectedField: boolean): NpCollectionConfig["fields"] => {
        const current = protectedField
          ? {
              ...field,
              ...(protection === "hidden" ? { hidden: true } : { admin: { readOnly: true } }),
            }
          : field;
        return [
          ...config.fields,
          boundary === "top"
            ? { type: "row", fields: [current] }
            : { name: "container", type: boundary, fields: [current] },
        ];
      };
      vi.mocked(getCollectionConfig).mockReturnValue({ ...config, fields: fields(false) });
      const value = { editable: "Formerly editable content" };
      const accepted = await prepare(
        create({
          title: "Draft",
          ...(boundary === "top" ? value : { container: boundary === "array" ? [value] : value }),
        }),
      );
      const context = {
        siteId: "default",
        user,
        operation: accepted.operation,
        canonicalResourceKey: accepted.canonicalResourceKey,
      };
      const service = createAgentChangeSetResourceServiceV1();
      await expect(service.assertVisible(context)).resolves.toEqual(["content:read"]);
      vi.mocked(getCollectionConfig).mockReturnValue({ ...config, fields: fields(true) });
      await expect(service.assertVisible(context)).rejects.toMatchObject({
        code: "CHANGESET_SCHEMA_INVALID",
        message: "ChangeSet resource input is invalid.",
      });
    },
  );
  it.each([
    { siteId: "other" },
    { id: otherId },
    { tempId: "temp" },
    { $ref: "temp" },
    { undeclared: true },
    { internal: "private" },
    { meta: { locked: "private" } },
  ])("rejects undeclared, framework or protected input %j", async (extra) => {
    await expect(prepare(create({ title: "Draft", ...extra }))).rejects.toMatchObject({
      code: "CHANGESET_SCHEMA_INVALID",
      status: 400,
    });
  });
  it("uses the existing create ACL and collapses opaque callback errors", async () => {
    vi.mocked(getCollectionConfig).mockReturnValue({
      ...config,
      access: {
        create: () => {
          throw new Error("private backend details");
        },
      },
    });
    await expect(prepare(create({ title: "Draft" }))).rejects.toMatchObject({
      code: "CHANGESET_ACCESS_DENIED",
      message: "ChangeSet resource access is denied.",
    });
  });
  it("rejects any newly reserved document reference before reading that target", async () => {
    await expect(prepare(create({ title: "Draft", related: otherId }))).rejects.toMatchObject({
      code: "CHANGESET_REFERENCE_INVALID",
    });
    expect(npGetPersistedCollectionDocumentById).toHaveBeenCalledTimes(1);
  });
  it("checks repeated relationship targets once per operation", async () => {
    vi.mocked(getCollectionConfig).mockReturnValue({
      ...config,
      fields: config.fields.map((field) =>
        "name" in field && field.name === "related"
          ? { ...field, type: "relationship", relationTo: "articles", hasMany: true }
          : field,
      ),
    });
    vi.mocked(npGetPersistedCollectionDocumentById)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: otherId, siteId: "default", status: "published" });
    await createAgentChangeSetResourceServiceV1().prepare({
      siteId: "default",
      user,
      operation: create({ title: "Draft", related: [otherId, otherId] }),
      canonicalResourceKey: { kind: "document", collection: "articles", documentId: id },
      reservedCreateDocumentIds: [id],
    });
    expect(npGetPersistedCollectionDocumentById).toHaveBeenCalledTimes(2);
  });
  it("does not change reservation identity or accept an already existing create target", async () => {
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({ id });
    await expect(prepare(create({ title: "Draft" }))).rejects.toMatchObject({
      code: "CHANGESET_REFERENCE_INVALID",
    });
  });
  it("keeps valid rich text and blocks under the existing framework validator", async () => {
    const body = npCreateEmptyRichTextContent();
    const blocks = [{ id: "block-1", type: "paragraph", props: { text: "Draft" } }];
    expect(await prepare(create({ title: "Draft", body, blocks }))).toMatchObject({
      operation: { input: { document: { body, blocks } } },
    });
  });
  it.each([
    ["upload", "hidden", "attach"],
    ["upload", "hidden", "detach"],
    ["upload", "readOnly", "attach"],
    ["upload", "readOnly", "detach"],
    ["richText", "hidden", "attach"],
    ["richText", "hidden", "detach"],
    ["richText", "readOnly", "attach"],
    ["richText", "readOnly", "detach"],
  ] as const)(
    "rejects media_ref for live %s %s fields during %s and reads",
    async (type, protection, action) => {
      vi.mocked(getCollectionConfig).mockReturnValue({
        ...config,
        fields: [
          ...config.fields,
          {
            type: "row",
            fields: [
              {
                name: "asset",
                ...(type === "upload" ? { type, relationTo: "media" as const } : { type }),
                ...(protection === "hidden" ? { hidden: true } : { admin: { readOnly: true } }),
              },
            ],
          },
        ],
      });
      vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({
        id,
        status: "published",
      });
      const operation: NpAgentChangeSetOperationInput = {
        clientOperationId: "media",
        reason: null,
        kind: "media_ref",
        operation: action,
        resource: { mediaId: otherId, collection: "articles", documentId: id, field: "asset" },
        base,
        input: {},
      };
      const context = {
        siteId: "default",
        user,
        operation,
        canonicalResourceKey: { kind: "media_ref" as const, ...operation.resource },
      };
      const service = createAgentChangeSetResourceServiceV1();
      await expect(
        service.prepare({ ...context, reservedCreateDocumentIds: [] }),
      ).rejects.toMatchObject({ code: "CHANGESET_SCHEMA_INVALID" });
      await expect(service.assertVisible(context)).rejects.toMatchObject({
        code: "CHANGESET_SCHEMA_INVALID",
      });
    },
  );
  it("does not flatten a protected group into an addressable media_ref field", async () => {
    vi.mocked(getCollectionConfig).mockReturnValue({
      ...config,
      fields: [
        ...config.fields,
        {
          name: "privateGroup",
          type: "group",
          hidden: true,
          fields: [{ name: "asset", type: "upload", relationTo: "media" }],
        },
      ],
    });
    vi.mocked(npGetPersistedCollectionDocumentById).mockResolvedValue({ id, status: "published" });
    const operation: NpAgentChangeSetOperationInput = {
      clientOperationId: "media",
      reason: null,
      kind: "media_ref",
      operation: "attach",
      resource: { mediaId: otherId, collection: "articles", documentId: id, field: "asset" },
      base,
      input: {},
    };
    const context = {
      siteId: "default",
      user,
      operation,
      canonicalResourceKey: { kind: "media_ref" as const, ...operation.resource },
    };
    const service = createAgentChangeSetResourceServiceV1();
    await expect(
      service.prepare({ ...context, reservedCreateDocumentIds: [] }),
    ).rejects.toMatchObject({ code: "CHANGESET_REFERENCE_INVALID" });
    await expect(service.assertVisible(context)).rejects.toMatchObject({
      code: "CHANGESET_REFERENCE_INVALID",
    });
    const dotted = {
      ...context,
      operation: { ...operation, resource: { ...operation.resource, field: "privateGroup.asset" } },
      canonicalResourceKey: { ...context.canonicalResourceKey, field: "privateGroup.asset" },
    };
    await expect(service.assertVisible(dotted)).rejects.toMatchObject({
      code: "CHANGESET_SCHEMA_INVALID",
    });
  });
  it("only accepts token changes for the existing active theme", async () => {
    const operation: NpAgentChangeSetOperationInput = {
      clientOperationId: "tokens",
      reason: null,
      kind: "theme_tokens",
      operation: "replace",
      resource: { themeId: "active" },
      base,
      input: { tokens: {} },
    };
    vi.mocked(getActiveTheme).mockResolvedValue({ manifest: { id: "other" } } as never);
    await expect(
      prepare(operation, { kind: "theme_tokens", themeId: "active" }),
    ).rejects.toMatchObject({ code: "CHANGESET_RESOURCE_NOT_FOUND" });
    vi.mocked(getActiveTheme).mockResolvedValue({ manifest: { id: "active" } } as never);
    expect(await prepare(operation, { kind: "theme_tokens", themeId: "active" })).toMatchObject({
      requiredScopes: ["theme:write"],
    });
  });
});
