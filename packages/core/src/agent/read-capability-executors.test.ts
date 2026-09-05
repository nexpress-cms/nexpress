import type { SQL } from "drizzle-orm";
import { PgDialect, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpFieldConfig } from "../config/types.js";

const mocks = vi.hoisted(() => ({
  findDocuments: vi.fn(),
  queryRows: [] as Array<{ id: string }>,
  getSiteById: vi.fn(),
  listEnabledPluginIds: vi.fn(),
  fields: [] as NpFieldConfig[],
  queryParameters: [] as unknown[],
}));

const posts = pgTable("np_test_agent_posts", {
  id: uuid("id").primaryKey(),
  siteId: text("site_id").notNull(),
  status: text("status").notNull(),
  visibility: text("visibility").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const collection = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  slugField: true,
  fields: [
    { name: "secretNote", type: "text", hidden: true },
    { name: "title", type: "text", required: true, maxLength: 200 },
    { name: "body", type: "richText" },
    { name: "layout", type: "blocks", allowedBlocks: ["core.hero"] },
  ],
} as const;

vi.mock("../collections/index.js", () => ({
  findDocuments: mocks.findDocuments,
  getAllCollectionSlugs: () => ["posts"],
  getCollectionConfig: (slug: string) => {
    if (slug !== "posts") throw new Error("missing collection");
    return { ...collection, fields: [...collection.fields, ...mocks.fields] };
  },
  getCollectionTable: () => posts,
}));

vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (where: SQL) => {
          mocks.queryParameters = new PgDialect().sqlToQuery(where).params;
          return {
            orderBy: () => ({
              limit: () => ({ offset: () => Promise.resolve(mocks.queryRows) }),
            }),
          };
        },
      }),
    }),
  }),
}));

vi.mock("../sites/registry.js", () => ({ getSiteById: mocks.getSiteById }));
vi.mock("../plugins/persistence.js", () => ({
  listEnabledPluginIds: mocks.listEnabledPluginIds,
}));
vi.mock("../i18n/registry.js", () => ({
  getI18nConfig: () => ({ defaultLocale: "en", locales: ["ko", "en"] }),
}));

import {
  npRequireAgentContentQueryOutputV1,
  npRequireAgentSchemaGetOutputV1,
  npRequireAgentSiteInspectOutputV1,
} from "../agent-contract/index.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "./read-capability-executors.js";

const requestedAt = "2026-08-30T00:00:00.000Z";
const context = {
  siteId: "default",
  principal: {
    kind: "service" as const,
    principalId: "01900000-0000-7000-8000-000000000010",
    siteId: "default",
    authority: { kind: "user" as const, userId: "01900000-0000-7000-8000-000000000011" },
    credentialId: "01900000-0000-7000-8000-000000000012",
    gatewayExposureCeiling: "read" as const,
    scopes: ["content:read" as const, "schema:read" as const, "site:read" as const],
  },
  requestedAt,
  invocationId: "01900000-0000-7000-8000-000000000013",
  idempotencyKey: null,
  abortSignal: new AbortController().signal,
};

function executors(cursorHmacKey = { id: "cursor-2026", key: new Uint8Array(32).fill(7) }) {
  return createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey,
    resolveBlockSchemas: () => [
      {
        type: "core.hero",
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties: {
            type: { const: "core.hero" },
            props: {
              type: "object",
              additionalProperties: false,
              properties: { title: { type: "string", maxLength: 200 } },
              required: ["title"],
            },
          },
          required: ["type", "props"],
        },
      },
    ],
    resolveUser: () => ({
      id: context.principal.authority.userId,
      email: "staff@example.test",
      name: "Staff",
      role: "editor",
      tokenVersion: 1,
    }),
    resolveGatewaySettings: () => ({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "read",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    }),
    runtimeState: () => "ready",
  });
}

describe("Agent core read capability executors", () => {
  beforeEach(() => {
    mocks.findDocuments.mockReset();
    mocks.getSiteById.mockReset();
    mocks.listEnabledPluginIds.mockReset();
    mocks.queryRows = [];
    mocks.fields = [];
    mocks.queryParameters = [];
  });

  it("projects safe site and exact schema resources from existing registries", async () => {
    mocks.getSiteById.mockResolvedValue({
      id: "default",
      name: "Default",
      settings: { defaultLocale: "ko" },
    });
    mocks.listEnabledPluginIds.mockResolvedValue(["plugin-b", "plugin-a"]);
    const installed = executors();
    const site = await installed["site.inspect"]({}, context);
    expect(npRequireAgentSiteInspectOutputV1(site)).toMatchObject({
      site: { defaultLocale: "ko", locales: ["en", "ko"] },
      features: { remoteMcp: false, agentHttp: false, runtime: "ready" },
      counts: { collections: 1, blocks: 1, activePlugins: 2 },
    });
    expect(site.resourceUris).toEqual([...site.resourceUris].sort());
    expect(site.resourceUris).toEqual([
      "nexpress://site/default/schema",
      "nexpress://site/default/schema/blocks",
      "nexpress://site/default/schema/collections/posts",
    ]);

    const schema = await installed["schema.get"](
      { selector: "collection", slug: "posts" },
      context,
    );
    expect(npRequireAgentSchemaGetOutputV1(schema)).toEqual(schema);
    expect(JSON.stringify(schema.schema)).toContain('"title"');
    expect(JSON.stringify(schema.schema)).toContain('"core.hero"');
    expect(JSON.stringify(schema.schema)).not.toContain("secretNote");
    const block = await installed["schema.get"]({ selector: "block", type: "core.hero" }, context);
    expect(JSON.stringify(block.schema)).toContain('"title"');
    const blocks = await installed["schema.get"]({ selector: "blocks" }, context);
    expect(npRequireAgentSchemaGetOutputV1(blocks)).toEqual(blocks);
  });

  it("keeps advanced selection site-bound while reusing hydrated collection reads", async () => {
    const firstId = "01900000-0000-7000-8000-000000000001";
    const secondId = "01900000-0000-7000-8000-000000000002";
    mocks.queryRows = [
      { id: firstId },
      { id: secondId },
      { id: "01900000-0000-7000-8000-000000000003" },
    ];
    mocks.findDocuments.mockResolvedValue({
      docs: [
        {
          id: secondId,
          slug: "second",
          status: "published",
          updatedAt: new Date("2026-08-29T00:00:00.000Z"),
          title: "Second",
        },
        {
          id: firstId,
          slug: "first",
          status: "published",
          updatedAt: new Date("2026-08-30T00:00:00.000Z"),
          title: "First",
        },
      ],
    });
    const output = await executors()["content.query"](
      {
        collection: "posts",
        filter: { op: "neq", field: "title", value: "Hidden" },
        fields: ["title"],
        audience: "public",
        status: "published",
        sort: [{ field: "updatedAt", direction: "desc" }],
        limit: 2,
        cursor: null,
      },
      context,
    );
    expect(npRequireAgentContentQueryOutputV1(output)).toEqual(output);
    expect(output.items.map((item) => item.id)).toEqual([firstId, secondId]);
    expect(output.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(mocks.findDocuments).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({
        where: expect.objectContaining({ siteId: "default", visibility: "public" }),
      }),
      undefined,
    );
  });

  it("excludes hidden and undeclared nested group/array fields without reading getters", async () => {
    const nestedFields: NpFieldConfig[] = [
      {
        type: "row",
        fields: [
          { name: "label", type: "text" },
          { name: "internalNote", type: "text", hidden: true },
        ],
      },
      {
        name: "children",
        type: "array",
        fields: [
          { name: "label", type: "text" },
          { name: "internalNote", type: "text", hidden: true },
        ],
      },
    ];
    mocks.fields = [
      { name: "details", type: "group", fields: nestedFields },
      { name: "entries", type: "array", fields: nestedFields },
    ];
    const hidden = vi.fn(() => "private nested evidence");
    const nested = () =>
      Object.defineProperty(
        {
          label: "Visible",
          undeclared: "not in the definition",
          children: [{ label: "Child", internalNote: "private nested evidence" }],
        },
        "internalNote",
        { enumerable: true, get: hidden },
      );
    const id = "01900000-0000-7000-8000-000000000040";
    mocks.queryRows = [{ id }];
    mocks.findDocuments.mockResolvedValue({
      docs: [
        {
          id,
          slug: "nested",
          status: "published",
          updatedAt: new Date(requestedAt),
          details: nested(),
          entries: [nested()],
        },
      ],
    });
    const output = await executors()["content.query"](
      {
        collection: "posts",
        filter: null,
        fields: ["details", "entries"],
        audience: "public",
        status: "published",
        sort: [],
        limit: 1,
        cursor: null,
      },
      context,
    );
    const visible = { label: "Visible", children: [{ label: "Child" }] };
    expect(output.items[0]?.data).toEqual({ details: visible, entries: [visible] });
    expect(hidden).not.toHaveBeenCalled();
    expect(npRequireAgentContentQueryOutputV1(output)).toEqual(output);
  });

  it.each(["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const)(
    "compiles canonical date %s filters with the real PostgreSQL encoder",
    async (op) => {
      await executors()["content.query"](
        {
          collection: "posts",
          filter:
            op === "in"
              ? { op, field: "updatedAt", values: [requestedAt, null] }
              : { op, field: "updatedAt", value: requestedAt },
          fields: [],
          audience: "public",
          status: "published",
          sort: [],
          limit: 1,
          cursor: null,
        },
        context,
      );
      expect(mocks.queryParameters).toContain(requestedAt);
    },
  );

  it("rejects invalid date filter values before PostgreSQL encoding", async () => {
    for (const value of ["invalid-date", "2026-02-30T00:00:00.000Z"]) {
      await expect(
        executors()["content.query"](
          {
            collection: "posts",
            filter: { op: "eq", field: "updatedAt", value },
            fields: [],
            audience: "public",
            status: "published",
            sort: [],
            limit: 1,
            cursor: null,
          },
          context,
        ),
      ).rejects.toThrow("Invalid Agent content query");
    }
  });

  it("projects JSON field schemas within the shared schema bounds", async () => {
    mocks.fields = [{ name: "metadata", type: "json" }];
    const output = await executors()["schema.get"](
      { selector: "collection", slug: "posts" },
      context,
    );
    expect(npRequireAgentSchemaGetOutputV1(output)).toEqual(output);
  });

  it("retains null as a valid value for optional select and radio fields", async () => {
    mocks.fields = ["select", "radio"].map((type) => ({
      name: type,
      type: type as "select" | "radio",
      options: [{ label: "One", value: "one" }],
    }));
    const output = await executors()["schema.get"](
      { selector: "collection", slug: "posts" },
      context,
    );
    expect(output.schema).toMatchObject({
      properties: {
        data: {
          properties: {
            select: { type: ["string", "null"], enum: ["one", null] },
            radio: { type: ["string", "null"], enum: ["one", null] },
          },
        },
      },
    });
  });

  it("rejects cursor tampering, hidden projection fields, and type-mismatched filters", async () => {
    const installed = executors();
    const base = {
      collection: "posts",
      filter: null,
      fields: ["title"],
      audience: "public" as const,
      status: "published" as const,
      sort: [],
      limit: 2,
      cursor: null,
    };
    await expect(
      installed["content.query"]({ ...base, fields: ["secretNote"] }, context),
    ).rejects.toThrow("Invalid Agent content query");
    await expect(
      installed["content.query"](
        { ...base, filter: { op: "gt", field: "title", value: 10 } },
        context,
      ),
    ).rejects.toThrow("Invalid Agent content query");
    await expect(
      installed["content.query"]({ ...base, cursor: "eyJvZmZzZXQiOjF9.invalid" }, context),
    ).rejects.toThrow("Invalid Agent content cursor");
    expect(() => executors({ id: "INVALID KEY", key: new Uint8Array(32) })).toThrow(
      "named HMAC key",
    );
  });

  it("copies cursor key bytes so installed cursors survive caller-side mutation", async () => {
    const key = new Uint8Array(32).fill(7);
    const installed = executors({ id: "cursor-2026", key });
    const request = {
      collection: "posts",
      filter: null,
      fields: [],
      audience: "public" as const,
      status: "published" as const,
      sort: [],
      limit: 1,
      cursor: null,
    };
    mocks.queryRows = [
      { id: "01900000-0000-7000-8000-000000000030" },
      { id: "01900000-0000-7000-8000-000000000031" },
    ];
    mocks.findDocuments.mockResolvedValue({ docs: [] });
    const first = await installed["content.query"](request, context);
    expect(first.nextCursor).not.toBeNull();

    key.fill(23);
    mocks.queryRows = [];
    await expect(
      installed["content.query"]({ ...request, cursor: first.nextCursor }, context),
    ).resolves.toMatchObject({ nextCursor: null });
  });

  it("rejects computed hydrated values without evaluating them", async () => {
    const id = "01900000-0000-7000-8000-000000000020";
    let evaluated = false;
    const doc = {
      id,
      slug: "computed",
      status: "published",
      updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    } as Record<string, unknown>;
    Object.defineProperty(doc, "title", {
      enumerable: true,
      get() {
        evaluated = true;
        return "secret";
      },
    });
    mocks.queryRows = [{ id }];
    mocks.findDocuments.mockResolvedValue({ docs: [doc] });
    await expect(
      executors()["content.query"](
        {
          collection: "posts",
          filter: null,
          fields: ["title"],
          audience: "public",
          status: "published",
          sort: [],
          limit: 1,
          cursor: null,
        },
        context,
      ),
    ).rejects.toThrow("computed");
    expect(evaluated).toBe(false);
  });

  it("rejects cyclic hydrated JSON before output projection", async () => {
    const id = "01900000-0000-7000-8000-000000000021";
    const body: Record<string, unknown> = {};
    body.self = body;
    mocks.queryRows = [{ id }];
    mocks.findDocuments.mockResolvedValue({
      docs: [
        {
          id,
          slug: "cyclic",
          status: "published",
          updatedAt: new Date("2026-08-30T00:00:00.000Z"),
          body,
        },
      ],
    });
    await expect(
      executors()["content.query"](
        {
          collection: "posts",
          filter: null,
          fields: ["body"],
          audience: "public",
          status: "published",
          sort: [],
          limit: 1,
          cursor: null,
        },
        context,
      ),
    ).rejects.toThrow("cyclic");
  });

  it.each([undefined, "invalid-date"])(
    "does not invent timestamps for malformed rows: %s",
    async (updatedAt) => {
      const id = "01900000-0000-7000-8000-000000000022";
      mocks.queryRows = [{ id }];
      mocks.findDocuments.mockResolvedValue({
        docs: [{ id, slug: "invalid", status: "published", updatedAt }],
      });
      await expect(
        executors()["content.query"](
          {
            collection: "posts",
            filter: null,
            fields: [],
            audience: "public",
            status: "published",
            sort: [],
            limit: 1,
            cursor: null,
          },
          context,
        ),
      ).rejects.toThrow("invalid update timestamp");
    },
  );
});
