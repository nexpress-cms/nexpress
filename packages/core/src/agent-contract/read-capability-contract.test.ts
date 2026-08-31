import { describe, expect, it } from "vitest";

import {
  npAgentReadCapabilityDescriptorsV1,
  npAnalyzeAgentContentQueryInputV1,
  npAnalyzeAgentContentQueryOutputV1,
  npAnalyzeAgentReadCapabilityInvocationRequestV1,
  npAnalyzeAgentSchemaGetInputV1,
  npAnalyzeAgentSiteInspectOutputV1,
  npRequireAgentCapabilityDescriptor,
} from "./index.js";

const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("Agent read capability contract", () => {
  it("locks the three exact server-owned read descriptors", () => {
    expect(Object.keys(npAgentReadCapabilityDescriptorsV1)).toEqual([
      "content.query",
      "schema.get",
      "site.inspect",
    ]);
    for (const [id, descriptor] of Object.entries(npAgentReadCapabilityDescriptorsV1)) {
      expect(npRequireAgentCapabilityDescriptor(descriptor)).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        id,
        risk: "read",
        approval: "none",
        execution: "inline",
        idempotency: "none",
        effectProfiles: [{ id: "domain.read", minimumGatewayExposure: "read" }],
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
      });
    }
  });

  it("parses exact schema selectors and rejects branch extras", () => {
    expect(npAnalyzeAgentSchemaGetInputV1({ selector: "catalog" })).toMatchObject({ ok: true });
    expect(npAnalyzeAgentSchemaGetInputV1({ selector: "collection", slug: "posts" })).toMatchObject(
      { ok: true },
    );
    expect(npAnalyzeAgentSchemaGetInputV1({ selector: "catalog", slug: "posts" })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.read.schemaGet.slug" }],
    });
  });

  it("bounds recursive content filters, fields, sorts, cursors, and idempotency", () => {
    const input = {
      collection: "posts",
      filter: {
        op: "all",
        terms: [
          { op: "eq", field: "status", value: "published" },
          { op: "in", field: "locale", values: ["en", "ko"] },
        ],
      },
      fields: ["locale", "title"],
      audience: "public",
      status: "published",
      sort: [{ field: "updatedAt", direction: "desc" }],
      limit: 20,
      cursor: null,
    } as const;
    expect(npAnalyzeAgentContentQueryInputV1(input)).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentReadCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "content.query",
        arguments: { input, idempotencyKey: null },
      }),
    ).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentReadCapabilityInvocationRequestV1({
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId: "content.query",
        arguments: { input, idempotencyKey: "caller-key" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      npAnalyzeAgentContentQueryInputV1({ ...input, fields: ["title", "locale"] }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "order" }],
    });
    expect(
      npAnalyzeAgentContentQueryInputV1({
        ...input,
        filter: { op: "eq", field: "title", value: "x".repeat(262_145) },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit" }] });
    expect(
      npAnalyzeAgentContentQueryInputV1({
        ...input,
        filter: {
          op: "in",
          field: "title",
          values: Array.from(
            { length: 100 },
            (_, index) => `${index.toString()}-${"x".repeat(11_000)}`,
          ),
        },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit", path: "agent.read.contentQuery" }] });
  });

  it("rejects hostile accessors without evaluating them", () => {
    let evaluated = false;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "selector", {
      enumerable: true,
      get() {
        evaluated = true;
        return "catalog";
      },
    });
    expect(npAnalyzeAgentSchemaGetInputV1(hostile)).toMatchObject({ ok: false });
    expect(evaluated).toBe(false);
  });

  it("validates client-safe outputs and excludes arbitrary top-level data", () => {
    expect(
      npAnalyzeAgentSiteInspectOutputV1({
        schemaVersion: "np.agent-site-inspect.v1",
        site: { id: "default", name: "기본 사이트", defaultLocale: "ko", locales: ["en", "ko"] },
        features: { remoteMcp: false, agentHttp: false, runtime: "disabled" },
        counts: { collections: 2, blocks: 0, activePlugins: 1 },
        resourceUris: ["nexpress://sites/default/schema/catalog"],
      }),
    ).toMatchObject({ ok: true });

    expect(
      npAnalyzeAgentContentQueryOutputV1({
        schemaVersion: "np.agent-content-query.v1",
        collection: "posts",
        items: [
          {
            id: "01900000-0000-7000-8000-000000000001",
            slug: "hello",
            status: "published",
            locale: "ko",
            version: "1",
            digest,
            updatedAt: "2026-08-30T00:00:00.000Z",
            data: { title: "Hello" },
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ ok: true });
  });

  it("requires sorted resource links and rejects hostile output data without evaluation", () => {
    const site = {
      schemaVersion: "np.agent-site-inspect.v1",
      site: { id: "default", name: "Default", defaultLocale: "en", locales: ["en"] },
      features: { remoteMcp: false, agentHttp: false, runtime: "disabled" },
      counts: { collections: 1, blocks: 0, activePlugins: 0 },
      resourceUris: [
        "nexpress://sites/default/schema/collections/posts",
        "nexpress://sites/default/schema/catalog",
      ],
    };
    expect(npAnalyzeAgentSiteInspectOutputV1(site)).toMatchObject({
      ok: false,
      issues: [{ code: "order" }],
    });

    let evaluated = false;
    const data = {} as Record<string, unknown>;
    Object.defineProperty(data, "secret", {
      enumerable: true,
      get() {
        evaluated = true;
        return "hidden";
      },
    });
    expect(
      npAnalyzeAgentContentQueryOutputV1({
        schemaVersion: "np.agent-content-query.v1",
        collection: "posts",
        items: [
          {
            id: "01900000-0000-7000-8000-000000000001",
            slug: null,
            status: "published",
            locale: null,
            version: "1",
            digest,
            updatedAt: "2026-08-30T00:00:00.000Z",
            data,
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ ok: false });
    expect(evaluated).toBe(false);
  });
});
