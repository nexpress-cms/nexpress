import { describe, expect, it } from "vitest";

import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";

import {
  NpDiscoveryContractError,
  npAnalyzeBlockDiscoveryResponse,
  npAnalyzeCollectionDiscoveryResponse,
  npAnalyzePluginDiscoveryResponse,
  npDiscoveryContractLimits,
  npRequireBlockDiscoveryResponse,
  npRequireCollectionDiscoveryResponse,
  npRequirePluginDiscoveryResponse,
} from "./index.js";

function collectionResponse() {
  return {
    items: [
      {
        slug: "posts",
        source: "project",
        labels: { singular: "Post", plural: "Posts" },
        slug_auto: true,
        i18n: false,
        timestamps: true,
        versions: { drafts: true, max: 20 },
        fields: [
          {
            name: "title",
            type: "text",
            source: "project",
            required: true,
            defaultValue: "Hello 👋",
          },
        ],
      },
    ],
  };
}

function blockResponse() {
  return {
    items: [
      {
        type: "plugin.callout",
        label: "Callout",
        source: "plugin:callout",
        keywords: ["notice"],
        defaultProps: { body: "Hello" },
        propsSchema: [{ name: "body", label: "Body", type: "text", translatable: true }],
        acceptsChildren: false,
        summaryFields: ["body"],
        allowedChildTypes: [],
      },
    ],
  };
}

function pluginResponse() {
  const empty = {
    blocks: [],
    patterns: [],
    templates: [],
    translations: [],
    collections: [],
    adminExtensions: [],
    actions: [],
    apiRoutes: [],
    pageRoutes: [],
    scheduledTasks: [],
    hooks: [],
  };
  return {
    items: [
      {
        apiVersion: "1",
        legacy: false,
        id: "demo",
        name: "Demo",
        version: "1.0.0",
        description: "Demo plugin",
        author: { name: "NexPress", url: "https://example.com" },
        license: "MIT",
        nexpress: { minVersion: "0.3.0", maxVersion: null },
        capabilities: ["api:route"],
        allowedHosts: [],
        requires: [],
        provides: empty,
        agent: { description: "Agent description", category: "utility", tags: ["demo"] },
        usesTokens: [],
        styleSlots: {},
        hooks: [],
        routes: [{ method: "GET", path: "/ping", auth: false }],
        pageRoutes: [],
        scheduledTasks: [],
        actions: [],
      },
    ],
  };
}

describe("public discovery contracts", () => {
  it("accepts and clones exact collection, block, and plugin envelopes", () => {
    expect(npRequireCollectionDiscoveryResponse(collectionResponse())).toEqual(
      collectionResponse(),
    );
    expect(npRequireBlockDiscoveryResponse(blockResponse())).toEqual(blockResponse());
    expect(npRequirePluginDiscoveryResponse(pluginResponse())).toEqual(pluginResponse());
  });

  it("rejects unknown fields and duplicate item identities", () => {
    const collection = collectionResponse();
    Object.assign(collection.items[0], { secret: true });
    expect(npAnalyzeCollectionDiscoveryResponse(collection)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "unknown-field" })]),
    });

    const duplicateFields = collectionResponse();
    duplicateFields.items[0].fields.push(structuredClone(duplicateFields.items[0].fields[0]));
    expect(npAnalyzeCollectionDiscoveryResponse(duplicateFields).ok).toBe(false);

    const blocks = blockResponse();
    blocks.items.push(structuredClone(blocks.items[0]));
    expect(npAnalyzeBlockDiscoveryResponse(blocks)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "duplicate" })]),
    });
  });

  it("enforces the discriminated block prop schema and sibling conditions", () => {
    const typeSpecific = blockResponse();
    Object.assign(typeSpecific.items[0].propsSchema[0], {
      options: [{ label: "Wrong", value: "wrong" }],
    });
    expect(npAnalyzeBlockDiscoveryResponse(typeSpecific).ok).toBe(false);

    const wrongDefault = blockResponse();
    Object.assign(wrongDefault.items[0].propsSchema[0], { defaultValue: 42 });
    expect(npAnalyzeBlockDiscoveryResponse(wrongDefault).ok).toBe(false);

    const literalDollar = blockResponse();
    literalDollar.items[0].defaultProps.body = "price$";
    Object.assign(literalDollar.items[0].propsSchema[0], { pattern: "price\\$" });
    expect(npRequireBlockDiscoveryResponse(literalDollar)).toEqual(literalDollar);

    const richText = blockResponse();
    const richTextContent = npCreateEmptyRichTextContent();
    Object.assign(richText.items[0], {
      defaultProps: { body: richTextContent },
      propsSchema: [
        {
          name: "body",
          label: "Body",
          type: "richtext",
          translatable: true,
          defaultValue: richTextContent,
        },
      ],
    });
    expect(npRequireBlockDiscoveryResponse(richText)).toEqual(richText);

    const unknownCondition = blockResponse();
    Object.assign(unknownCondition.items[0].propsSchema[0], {
      visibleWhen: [["missing", true]],
    });
    expect(npAnalyzeBlockDiscoveryResponse(unknownCondition).ok).toBe(false);

    const removedMedia = blockResponse();
    const removedMediaField = removedMedia.items[0].propsSchema[0] as Record<string, unknown>;
    removedMediaField.type = "media";
    delete removedMediaField.translatable;
    expect(npAnalyzeBlockDiscoveryResponse(removedMedia).ok).toBe(false);

    const tooDeep = blockResponse();
    let nestedSchema: Array<Record<string, unknown>> = [
      { name: "leaf", label: "Leaf", type: "boolean" },
    ];
    for (let depth = 0; depth <= npDiscoveryContractLimits.blockSchemaDepth; depth += 1) {
      nestedSchema = [
        {
          name: `items_${depth.toString()}`,
          label: "Items",
          type: "array",
          itemSchema: nestedSchema,
        },
      ];
    }
    Object.assign(tooDeep.items[0], {
      defaultProps: {},
      propsSchema: nestedSchema,
      summaryFields: [],
    });
    expect(npAnalyzeBlockDiscoveryResponse(tooDeep).ok).toBe(false);
  });

  it("fails closed on accessors without executing them", () => {
    let reads = 0;
    const plugin = pluginResponse();
    Object.defineProperty(plugin.items[0], "name", {
      enumerable: true,
      get() {
        reads += 1;
        return "unsafe";
      },
    });

    expect(() => npRequirePluginDiscoveryResponse(plugin)).toThrow(NpDiscoveryContractError);
    expect(reads).toBe(0);
  });

  it("rejects values JSON cannot preserve", () => {
    const blocks = blockResponse();
    Object.assign(blocks.items[0], { defaultProps: { missing: undefined } });
    expect(npAnalyzeBlockDiscoveryResponse(blocks)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "invalid-field" })]),
    });

    const plugin = pluginResponse();
    Object.assign(plugin.items[0], {
      agent: {
        ...plugin.items[0].agent,
        configSchema: { score: Number.POSITIVE_INFINITY },
      },
    });
    expect(npAnalyzePluginDiscoveryResponse(plugin).ok).toBe(false);

    const canonical = pluginResponse();
    Object.assign(canonical.items[0], {
      agent: { description: "", category: null, tags: [], configSchema: { offset: -0 } },
    });
    expect(npRequirePluginDiscoveryResponse(canonical).items[0]?.agent.configSchema).toEqual({
      offset: 0,
    });
  });

  it("enforces field-kind and plugin-version invariants", () => {
    const collection = collectionResponse();
    Object.assign(collection.items[0].fields[0], { relationTo: "authors" });
    expect(npAnalyzeCollectionDiscoveryResponse(collection).ok).toBe(false);

    const blocks = blockResponse();
    Object.assign(blocks.items[0].propsSchema[0], { translatable: undefined });
    expect(npAnalyzeBlockDiscoveryResponse(blocks).ok).toBe(false);

    const plugin = pluginResponse();
    plugin.items[0].legacy = true;
    expect(npAnalyzePluginDiscoveryResponse(plugin).ok).toBe(false);

    const badUrl = pluginResponse();
    Object.assign(badUrl.items[0], { author: { name: "NexPress", url: "not a URL" } });
    expect(npAnalyzePluginDiscoveryResponse(badUrl).ok).toBe(false);
  });

  it("contains revoked proxy inspection failures", () => {
    const { proxy, revoke } = Proxy.revocable(collectionResponse(), {});
    revoke();

    expect(() => npAnalyzeCollectionDiscoveryResponse(proxy)).not.toThrow();
    expect(npAnalyzeCollectionDiscoveryResponse(proxy).ok).toBe(false);
  });
});
