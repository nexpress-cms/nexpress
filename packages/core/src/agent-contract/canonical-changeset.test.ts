import { describe, expect, it } from "vitest";
import { DEFAULT_SEO_SETTINGS } from "../settings/contract.js";
import { npAgentContractLimits } from "./contract.js";
import {
  npAgentChangeSetOperationIncludedKeysV1,
  npAgentChangeSetOperationInputIncludedKeysV1,
  npAgentChangeSetOperationResourceIncludedKeysV1,
  npAgentChangeSetResourceKeyIncludedKeysV1,
  npAgentVersionBaseIncludedKeysV1,
  npAnalyzeAgentChangeSetOperationInput,
  npAnalyzeAgentVersionBase,
  npRequireAgentChangeSetOperationInput,
  npRequireAgentChangeSetResourceKey,
} from "./changeset-contract.js";
import {
  npAgentChangeSetProposalCanonicalExcludedKeysV1,
  npAgentChangeSetProposalCanonicalIncludedKeysV1,
  npAgentChangeSetProposalOperationCanonicalIncludedKeysV1,
  npAgentChangeSetSnapshotCanonicalExcludedKeysV1,
  npAgentChangeSetSnapshotCanonicalIncludedKeysV1,
  npAnalyzeAgentChangeSetProposalCanonical,
  npAnalyzeAgentChangeSetSnapshotCanonical,
  npBuildAgentChangeSetProposalCanonicalBytes,
  npBuildAgentChangeSetSnapshotCanonicalBytes,
  npDigestAgentChangeSetProposalCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
  npRequireAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetSnapshotCanonical,
} from "./canonical-changeset.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentChangeSetResourceKinds,
  npAgentChangeSetSnapshotPresences,
  npAgentDocumentChangeSetOperations,
  npAgentMutableSettingKeys,
  type NpAgentChangeSetOperationInput,
  type NpAgentChangeSetProposalCanonicalV1,
  type NpAgentChangeSetResourceKeyV1,
  type NpAgentChangeSetSnapshotCanonicalV1,
} from "./types.js";

const decoder = new TextDecoder();
const documentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const mediaId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const changeSetId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const reservedDocumentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const base = { version: "v7", digest } as const;
const common = { clientOperationId: "client-op-1", reason: null } as const;
const seoValue = {
  defaultOgImage: null,
  twitterHandle: null,
  defaultLocale: "en_US",
} as const;
type DocumentCreateOperation = Extract<
  NpAgentChangeSetOperationInput,
  { kind: "document"; operation: "create" }
>;

const operationCases: Array<{
  operation: NpAgentChangeSetOperationInput;
  resourceKey: NpAgentChangeSetResourceKeyV1;
}> = [
  {
    operation: {
      ...common,
      kind: "document",
      operation: "create",
      resource: { collection: "articles", documentId: null },
      base: null,
      input: { document: { title: "Hello", featured: true }, targetStatus: "draft" },
    },
    resourceKey: { kind: "document", collection: "articles", documentId: reservedDocumentId },
  },
  {
    operation: {
      ...common,
      kind: "document",
      operation: "update",
      resource: { collection: "articles", documentId },
      base,
      input: { patch: { title: "Updated" }, targetStatus: null },
    },
    resourceKey: { kind: "document", collection: "articles", documentId },
  },
  ...(["publish", "archive"] as const).map((operation) => ({
    operation: {
      ...common,
      kind: "document" as const,
      operation,
      resource: { collection: "articles", documentId },
      base,
      input: {},
    },
    resourceKey: { kind: "document" as const, collection: "articles", documentId },
  })),
  {
    operation: {
      ...common,
      kind: "document",
      operation: "schedule",
      resource: { collection: "articles", documentId },
      base,
      input: { publishAt: "2026-08-24T00:00:00.000Z" },
    },
    resourceKey: { kind: "document", collection: "articles", documentId },
  },
  {
    operation: {
      ...common,
      kind: "navigation",
      operation: "replace",
      resource: { location: "header" },
      base,
      input: { items: [{ id: "home", label: "Home", type: "link", url: "/" }] },
    },
    resourceKey: { kind: "navigation", location: "header" },
  },
  {
    operation: {
      ...common,
      kind: "theme_tokens",
      operation: "replace",
      resource: { themeId: "community" },
      base,
      input: { tokens: { colors: { primary: "#123456" } } },
    },
    resourceKey: { kind: "theme_tokens", themeId: "community" },
  },
  {
    operation: {
      ...common,
      kind: "setting",
      operation: "replace",
      resource: { key: "seo" },
      base: null,
      input: { value: seoValue },
    },
    resourceKey: { kind: "setting", key: "seo" },
  },
  {
    operation: {
      ...common,
      kind: "setting",
      operation: "remove",
      resource: { key: "seo" },
      base,
      input: {},
    },
    resourceKey: { kind: "setting", key: "seo" },
  },
  ...(["attach", "detach"] as const).map((operation) => ({
    operation: {
      ...common,
      kind: "media_ref" as const,
      operation,
      resource: { mediaId, collection: "articles", documentId, field: "heroImage" },
      base,
      input: {},
    },
    resourceKey: {
      kind: "media_ref" as const,
      mediaId,
      collection: "articles",
      documentId,
      field: "heroImage",
    },
  })),
];

function proposal(
  operations = operationCases.slice(0, 2).map((entry, index) => ({
    ordinal: index + 1,
    operation: entry.operation,
    canonicalResourceKey: entry.resourceKey,
  })),
): NpAgentChangeSetProposalCanonicalV1 {
  return {
    schemaVersion: "np.agent-changeset-proposal.v1",
    siteId: "docs-site",
    changeSetId,
    draftVersion: 3,
    title: "Publish the launch article",
    summary: null,
    operations,
  };
}

function snapshot(
  overrides: Partial<NpAgentChangeSetSnapshotCanonicalV1> = {},
): NpAgentChangeSetSnapshotCanonicalV1 {
  return {
    schemaVersion: "np.agent-changeset-snapshot.v1",
    siteId: "docs-site",
    changeSetId,
    operationOrdinal: 1,
    canonicalResourceKey: { kind: "document", collection: "articles", documentId },
    presence: "present",
    base,
    value: { title: "Before" },
    ...overrides,
  };
}

function createOperation(index: number, payload = "x"): DocumentCreateOperation {
  return {
    clientOperationId: `create-${index.toString()}`,
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: `articles-${index.toString()}`, documentId: null },
    base: null,
    input: { document: { payload }, targetStatus: "draft" },
  };
}

describe("Agent ChangeSet owner and canonical contracts", () => {
  it("publishes exact inventories and included/excluded field fixtures", () => {
    expect(npAgentChangeSetResourceKinds).toEqual([
      "document",
      "navigation",
      "theme_tokens",
      "setting",
      "media_ref",
    ]);
    expect(npAgentMutableSettingKeys).toEqual(["seo"]);
    expect(npAgentDocumentChangeSetOperations).toEqual([
      "create",
      "update",
      "publish",
      "schedule",
      "archive",
    ]);
    expect(npAgentChangeSetSnapshotPresences).toEqual(["present", "absent"]);
    expect(npAgentChangeSetOperationIncludedKeysV1).toEqual([
      "clientOperationId",
      "reason",
      "kind",
      "operation",
      "resource",
      "base",
      "input",
    ]);
    expect(npAgentVersionBaseIncludedKeysV1).toEqual(["version", "digest"]);
    expect(npAgentChangeSetOperationResourceIncludedKeysV1).toEqual({
      document: ["collection", "documentId"],
      navigation: ["location"],
      theme_tokens: ["themeId"],
      setting: ["key"],
      media_ref: ["mediaId", "collection", "documentId", "field"],
    });
    expect(npAgentChangeSetOperationInputIncludedKeysV1).toEqual({
      "document.create": ["document", "targetStatus"],
      "document.update": ["patch", "targetStatus"],
      "document.publish": [],
      "document.archive": [],
      "document.schedule": ["publishAt"],
      "navigation.replace": ["items"],
      "theme_tokens.replace": ["tokens"],
      "setting.replace": ["value"],
      "setting.remove": [],
      "media_ref.attach": [],
      "media_ref.detach": [],
    });
    expect(npAgentChangeSetResourceKeyIncludedKeysV1).toEqual({
      document: ["kind", "collection", "documentId"],
      navigation: ["kind", "location"],
      theme_tokens: ["kind", "themeId"],
      setting: ["kind", "key"],
      media_ref: ["kind", "mediaId", "collection", "documentId", "field"],
    });
    expect(npAgentChangeSetProposalCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "changeSetId",
      "draftVersion",
      "title",
      "summary",
      "operations",
    ]);
    expect(npAgentChangeSetProposalOperationCanonicalIncludedKeysV1).toEqual([
      "ordinal",
      "operation",
      "canonicalResourceKey",
    ]);
    expect(npAgentChangeSetSnapshotCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "changeSetId",
      "operationOrdinal",
      "canonicalResourceKey",
      "presence",
      "base",
      "value",
    ]);
    expect(npAgentChangeSetProposalCanonicalExcludedKeysV1).toEqual([
      "draftHash",
      "planHash",
      "baseFingerprint",
      "risk",
      "validation",
      "validationDigest",
      "preview",
      "approval",
      "schedule",
      "execution",
      "verification",
      "rollback",
      "state",
      "createdAt",
      "updatedAt",
      "expiresAt",
    ]);
    expect(npAgentChangeSetSnapshotCanonicalExcludedKeysV1).toEqual([
      "snapshotHash",
      "capturedAt",
      "beforeHash",
      "afterHash",
      "applyResult",
      "verificationResult",
      "state",
      "errorCode",
      "expiresAt",
      "deletedAt",
    ]);
  });

  it("accepts every exact operation branch and all five canonical resource-key kinds", () => {
    for (const { operation, resourceKey } of operationCases) {
      const parsedOperation = npRequireAgentChangeSetOperationInput(operation);
      const parsedKey = npRequireAgentChangeSetResourceKey(resourceKey);
      expect(parsedOperation).toEqual(operation);
      expect(parsedKey).toEqual(resourceKey);
      expect(parsedOperation).not.toBe(operation);
      expect(parsedKey).not.toBe(resourceKey);
    }
  });

  it("enforces operation/base/input matrices and reuses client-safe owner analyzers", () => {
    const create = operationCases[0].operation;
    const update = operationCases[1].operation;
    const navigation = operationCases[5].operation;
    const theme = operationCases[6].operation;
    const setting = operationCases[7].operation;
    const schedule = operationCases[4].operation;
    const media = operationCases[9].operation;
    const invalid = [
      { ...create, base },
      { ...create, resource: { collection: "articles", documentId } },
      { ...update, base: null },
      { ...update, input: { patch: [], targetStatus: null } },
      { ...schedule, input: { publishAt: "2026-08-24T00:00:00Z" } },
      { ...navigation, resource: { location: "Header" } },
      { ...navigation, input: { items: [{ id: "x", label: " X ", type: "link", url: "/" }] } },
      { ...theme, input: { tokens: { colors: { primary: "url(https://bad.test/x)" } } } },
      { ...setting, resource: { key: "site-quotas" } },
      { ...setting, input: { value: { ...DEFAULT_SEO_SETTINGS, typo: true } } },
      { ...media, resource: { ...media.resource, field: "Hero-Image" } },
      { ...media, operation: "replace" },
      { ...media, input: { unexpected: true } },
      { ...media, extra: true },
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetOperationInput(value).ok).toBe(false);
    }

    expect(npAnalyzeAgentVersionBase(base)).toEqual({ ok: true, value: base });
    expect(npAnalyzeAgentVersionBase({ ...base, digest: "sha256:not-canonical" }).ok).toBe(false);
    expect(npAnalyzeAgentVersionBase({ ...base, version: "contains space" }).ok).toBe(false);
  });

  it("requires exact proposal resource identity, including a reserved create UUID", () => {
    for (const [index, entry] of operationCases.entries()) {
      expect(
        npAnalyzeAgentChangeSetProposalCanonical(
          proposal([
            {
              ordinal: index + 1,
              operation: entry.operation,
              canonicalResourceKey: entry.resourceKey,
            },
          ]),
        ).ok,
      ).toBe(true);
    }
    expect(
      npAnalyzeAgentChangeSetProposalCanonical(
        proposal([
          {
            ordinal: 1,
            operation: operationCases[0].operation,
            canonicalResourceKey: {
              kind: "document",
              collection: "other",
              documentId: reservedDocumentId,
            },
          },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetProposalCanonical(
        proposal([
          {
            ordinal: 1,
            operation: operationCases[1].operation,
            canonicalResourceKey: {
              kind: "document",
              collection: "articles",
              documentId: reservedDocumentId,
            },
          },
        ]),
      ).ok,
    ).toBe(false);
  });

  it("requires sorted unique positive ordinals and enforces operation/collection limits", () => {
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposal([])).ok).toBe(true);
    expect(
      npAnalyzeAgentChangeSetProposalCanonical(
        proposal([
          {
            ordinal: 2,
            operation: operationCases[0].operation,
            canonicalResourceKey: operationCases[0].resourceKey,
          },
          {
            ordinal: 1,
            operation: operationCases[1].operation,
            canonicalResourceKey: operationCases[1].resourceKey,
          },
        ]),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetProposalCanonical(
        proposal([
          {
            ordinal: 1,
            operation: operationCases[0].operation,
            canonicalResourceKey: operationCases[0].resourceKey,
          },
          {
            ordinal: 1,
            operation: operationCases[1].operation,
            canonicalResourceKey: operationCases[1].resourceKey,
          },
        ]),
      ).ok,
    ).toBe(false);

    const operations = Array.from(
      { length: npAgentContractLimits.changeSetOperations },
      (_, index) => {
        const operation = createOperation(index);
        return {
          ordinal: index + 1,
          operation,
          canonicalResourceKey: {
            kind: "document" as const,
            collection: operation.resource.collection,
            documentId: reservedDocumentId,
          },
        };
      },
    );
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposal(operations.slice(0, 64))).ok).toBe(
      true,
    );
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposal(operations.slice(0, 65))).ok).toBe(
      false,
    );
    const oneCollection = operations.map((entry) => ({
      ...entry,
      operation: {
        ...entry.operation,
        resource: { collection: "articles", documentId: null },
      },
      canonicalResourceKey: { ...entry.canonicalResourceKey, collection: "articles" },
    }));
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposal(oneCollection)).ok).toBe(true);
    expect(
      npAnalyzeAgentChangeSetProposalCanonical(
        proposal([
          ...oneCollection,
          {
            ...oneCollection[0],
            ordinal: npAgentContractLimits.changeSetOperations + 1,
            operation: { ...oneCollection[0].operation, clientOperationId: "overflow" },
          },
        ]),
      ).ok,
    ).toBe(false);
  });

  it("enforces explanatory text and exact closed fields at every level", () => {
    expect(
      npAnalyzeAgentChangeSetProposalCanonical({
        ...proposal(),
        title: "x".repeat(npAgentContractLimits.changeSetExplanatoryCharacters),
        summary: "",
      }).ok,
    ).toBe(true);
    const invalid = [
      { ...proposal(), title: "" },
      {
        ...proposal(),
        summary: "x".repeat(npAgentContractLimits.changeSetExplanatoryCharacters + 1),
      },
      { ...proposal(), draftHash: digest },
      { ...proposal(), operations: [{ ...proposal().operations[0], beforeHash: null }] },
      {
        ...proposal(),
        operations: [
          {
            ...proposal().operations[0],
            canonicalResourceKey: {
              ...proposal().operations[0].canonicalResourceKey,
              extra: true,
            },
          },
        ],
      },
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetProposalCanonical(value).ok).toBe(false);
    }
  });

  it("enforces the snapshot presence/base/value matrix and exact resource keys", () => {
    const present = npRequireAgentChangeSetSnapshotCanonical(snapshot());
    const absent = npRequireAgentChangeSetSnapshotCanonical(
      snapshot({ presence: "absent", base: null, value: null }),
    );
    expect(present).toEqual(snapshot());
    expect(absent.presence).toBe("absent");
    expect(present).not.toBe(snapshot());
    const invalid = [
      snapshot({ presence: "absent", base: null }),
      snapshot({ presence: "absent", value: null }),
      snapshot({ base: null }),
      snapshot({ value: null }),
      snapshot({ operationOrdinal: 0 }),
      { ...snapshot(), snapshotHash: digest },
      { ...snapshot(), base: { ...base, extra: true } },
      { ...snapshot(), canonicalResourceKey: { kind: "setting", key: "community" } },
      { ...snapshot(), value: Number.POSITIVE_INFINITY },
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentChangeSetSnapshotCanonical(value).ok).toBe(false);
    }
  });

  it("enforces exact proposal and snapshot canonical-byte ceilings", () => {
    const snapshotAtLimit = snapshot({ value: { payload: "" } });
    const snapshotBytes = npBuildAgentChangeSetSnapshotCanonicalBytes(snapshotAtLimit);
    const snapshotRemainder =
      npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-snapshot.v1"] -
      snapshotBytes.canonicalJsonUtf8.byteLength;
    snapshotAtLimit.value = { payload: "x".repeat(snapshotRemainder) };
    expect(
      npBuildAgentChangeSetSnapshotCanonicalBytes(snapshotAtLimit).canonicalJsonUtf8,
    ).toHaveLength(npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-snapshot.v1"]);
    snapshotAtLimit.value = { payload: "x".repeat(snapshotRemainder + 1) };
    expect(npAnalyzeAgentChangeSetSnapshotCanonical(snapshotAtLimit).ok).toBe(false);

    const largeOperations = [0, 1, 2].map((index) => {
      const operation = createOperation(index, "");
      return {
        ordinal: index + 1,
        operation,
        canonicalResourceKey: {
          kind: "document" as const,
          collection: operation.resource.collection,
          documentId: reservedDocumentId,
        },
      };
    });
    const proposalAtLimit = proposal(largeOperations);
    let remaining =
      npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-proposal.v1"] -
      npBuildAgentChangeSetProposalCanonicalBytes(proposalAtLimit).canonicalJsonUtf8.byteLength;
    for (const entry of largeOperations) {
      const length = Math.min(remaining, 1_999_999);
      if (entry.operation.kind !== "document" || entry.operation.operation !== "create") {
        throw new Error("unexpected operation branch");
      }
      entry.operation.input.document.payload = "x".repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    expect(
      npBuildAgentChangeSetProposalCanonicalBytes(proposalAtLimit).canonicalJsonUtf8,
    ).toHaveLength(npAgentCanonicalBodyMaxBytesV1["np.agent-changeset-proposal.v1"]);
    const final = largeOperations.at(-1)!.operation;
    if (final.kind !== "document" || final.operation !== "create") {
      throw new Error("unexpected operation branch");
    }
    const finalPayload = final.input.document.payload;
    if (typeof finalPayload !== "string") throw new Error("unexpected payload type");
    final.input.document.payload = `${finalPayload}x`;
    expect(npAnalyzeAgentChangeSetProposalCanonical(proposalAtLimit).ok).toBe(false);
  });

  it("inspects hostile values without invoking accessors and rejects unsafe JSON graphs", () => {
    let reads = 0;
    const proxied = new Proxy(proposal(), {
      get() {
        reads += 1;
        throw new Error("hostile get");
      },
    });
    expect(npRequireAgentChangeSetProposalCanonical(proxied)).toEqual(proposal());
    expect(reads).toBe(0);

    const accessor = proposal() as NpAgentChangeSetProposalCanonicalV1 & { draftHash?: string };
    Object.defineProperty(accessor, "draftHash", {
      enumerable: true,
      get() {
        reads += 1;
        return digest;
      },
    });
    expect(npAnalyzeAgentChangeSetProposalCanonical(accessor).ok).toBe(false);
    expect(reads).toBe(0);

    const hostile = new Proxy(snapshot(), {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(npAnalyzeAgentChangeSetSnapshotCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = { value: true };
    const sparse = Array(1);
    for (const value of [
      snapshot({ value: cycle as never }),
      snapshot({ value: { first: shared, second: shared } }),
      snapshot({ value: sparse }),
      snapshot({ value: 1n as never }),
      snapshot({ value: "\ud800" }),
    ]) {
      expect(npAnalyzeAgentChangeSetSnapshotCanonical(value).ok).toBe(false);
    }
  });

  it("emits stable domain-separated proposal and present/absent snapshot golden vectors", async () => {
    const goldenProposal = proposal([
      {
        ordinal: 1,
        operation: operationCases[0].operation,
        canonicalResourceKey: operationCases[0].resourceKey,
      },
    ]);
    const goldenPresent = snapshot();
    const goldenAbsent = snapshot({ presence: "absent", base: null, value: null });
    const vectors = [
      {
        purpose: "np.agent-changeset-proposal.v1",
        built: npBuildAgentChangeSetProposalCanonicalBytes(goldenProposal),
        digest: await npDigestAgentChangeSetProposalCanonical(goldenProposal),
        expectedJson:
          '{"changeSetId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3","draftVersion":3,"operations":[{"canonicalResourceKey":{"collection":"articles","documentId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd4","kind":"document"},"operation":{"base":null,"clientOperationId":"client-op-1","input":{"document":{"featured":true,"title":"Hello"},"targetStatus":"draft"},"kind":"document","operation":"create","reason":null,"resource":{"collection":"articles","documentId":null}},"ordinal":1}],"schemaVersion":"np.agent-changeset-proposal.v1","siteId":"docs-site","summary":null,"title":"Publish the launch article"}',
        expectedDigest: "cj1:sha256:MBbf3DqMbtiXfo5A_5xmHuiiEYDWjgCBN7nITup7QNQ",
      },
      {
        purpose: "np.agent-changeset-snapshot.v1",
        built: npBuildAgentChangeSetSnapshotCanonicalBytes(goldenPresent),
        digest: await npDigestAgentChangeSetSnapshotCanonical(goldenPresent),
        expectedJson:
          '{"base":{"digest":"cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","version":"v7"},"canonicalResourceKey":{"collection":"articles","documentId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1","kind":"document"},"changeSetId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3","operationOrdinal":1,"presence":"present","schemaVersion":"np.agent-changeset-snapshot.v1","siteId":"docs-site","value":{"title":"Before"}}',
        expectedDigest: "cj1:sha256:GiweS8LcDu-lZPv6Uof5UTxKCgK5Hyjl1sxP7OmRIUk",
      },
      {
        purpose: "np.agent-changeset-snapshot.v1",
        built: npBuildAgentChangeSetSnapshotCanonicalBytes(goldenAbsent),
        digest: await npDigestAgentChangeSetSnapshotCanonical(goldenAbsent),
        expectedJson:
          '{"base":null,"canonicalResourceKey":{"collection":"articles","documentId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1","kind":"document"},"changeSetId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3","operationOrdinal":1,"presence":"absent","schemaVersion":"np.agent-changeset-snapshot.v1","siteId":"docs-site","value":null}',
        expectedDigest: "cj1:sha256:lQTca7imXOfLI6ZYvIEQ8a41_2MRjPI_gTcdzeN1U90",
      },
    ] as const;

    for (const vector of vectors) {
      const json = decoder.decode(vector.built.canonicalJsonUtf8);
      expect(vector.built.purpose).toBe(vector.purpose);
      expect(json).toBe(vector.expectedJson);
      expect(decoder.decode(vector.built.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0${vector.purpose}\0${json}`,
      );
      expect(vector.digest).toBe(vector.expectedDigest);
    }
    expect(vectors[1].digest).not.toBe(vectors[2].digest);
    expect(vectors[0].digest).not.toBe(vectors[1].digest);
  });
});
