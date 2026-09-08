import { describe, expect, it } from "vitest";
import {
  npAnalyzeAgentChangeSetDraftInputV1,
  npRequireAgentChangeSetDraftInputV1,
  npBuildAgentChangeSetDraftInputJsonV1,
  npDigestAgentChangeSetDraftInputV1,
  npRequireAgentChangeSetAdminInputV1,
  npVerifyAgentChangeSetAdminProposalV1,
  npAnalyzeAgentChangeSetWire,
  npRequireAgentChangeSetWire,
  npAnalyzeAgentApprovalWire,
  npAgentChangeSetWireExcludedKeysV1,
  npAgentChangeSetWireContractV1,
  npDigestAgentChangeSetWireContractV1,
  npAgentChangeSetLimits,
} from "./changeset-wire-contract.js";
import { npRequireAgentChangeSetOperationInput } from "./changeset-contract.js";
const id = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const hash = `cj1:sha256:${"a".repeat(43)}`;
const operation = () =>
  npRequireAgentChangeSetOperationInput({
    clientOperationId: "op1",
    reason: null,
    kind: "document",
    operation: "create",
    resource: { collection: "posts", documentId: null },
    base: null,
    input: { document: { title: "Hello" }, targetStatus: "draft" },
  });
const draft = () => ({ title: "Draft", summary: null, operations: [operation()] });
const wire = () => ({
  schemaVersion: "np.agent-changeset.v1",
  id,
  siteId: "default",
  title: "Draft",
  summary: null,
  state: "draft",
  actor: { id: resourceId, kind: "staff", name: "Staff" },
  agentId: null,
  agentVersionId: null,
  agentConfigHash: null,
  runId: null,
  planHash: null,
  baseFingerprint: null,
  draftVersion: 1,
  draftHash: hash,
  risk: null,
  operations: [
    {
      ordinal: 1,
      operation: operation(),
      canonicalResourceKey: { kind: "document", collection: "posts", documentId: resourceId },
      beforeHash: null,
      afterHash: null,
      state: "draft",
      issues: [],
      resultDigest: null,
    },
  ],
  validation: null,
  preview: null,
  approval: null,
  schedule: null,
  execution: null,
  verification: null,
  rollback: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  expiresAt: "2026-10-08T00:00:00.000Z",
});
const approval = () => ({
  id,
  generation: 1,
  state: "pending",
  statementHash: hash,
  requiredHumanCapabilities: ["content.author"],
  requiredHumanPredicates: [],
  requestedAt: "2026-09-08T00:00:00.000Z",
  expiresAt: "2026-09-09T00:00:00.000Z",
  decidedAt: null,
});

describe("ChangeSet draft and client-safe wire contract", () => {
  it("locks the closed inventories, limits and domain-separated canonical fingerprints", async () => {
    expect(npAgentChangeSetWireContractV1.resourceKinds).toEqual([
      "document",
      "navigation",
      "theme_tokens",
      "setting",
      "media_ref",
    ]);
    expect(npAgentChangeSetLimits.operations).toBe(500);
    expect(npAgentChangeSetLimits.planBytes).toBe(4194304);
    expect(npBuildAgentChangeSetDraftInputJsonV1(draft())).toMatchInlineSnapshot(
      `"{"operations":[{"base":null,"clientOperationId":"op1","input":{"document":{"title":"Hello"},"targetStatus":"draft"},"kind":"document","operation":"create","reason":null,"resource":{"collection":"posts","documentId":null}}],"summary":null,"title":"Draft"}"`,
    );
    expect(await npDigestAgentChangeSetDraftInputV1(draft())).toMatchInlineSnapshot(
      `"cj1:sha256:Mh2d4WjSiEnqcJbRDeJsgFmR8b8E_vSxJ_NGhYWpNS8"`,
    );
    expect(await npDigestAgentChangeSetWireContractV1()).toMatchInlineSnapshot(
      `"cj1:sha256:GaDnrqmIOmFAzPgKAXQUE1qHc_fHH33_-JpVR-qmMfk"`,
    );
    expect(
      await npDigestAgentChangeSetDraftInputV1({
        operations: draft().operations,
        summary: null,
        title: "Draft",
      }),
    ).toBe(await npDigestAgentChangeSetDraftInputV1(draft()));
  });
  it("reuses operation branches and rejects server-owned keys and unregistered resources", () => {
    expect(npRequireAgentChangeSetDraftInputV1(draft())).toEqual(draft());
    expect(npRequireAgentChangeSetDraftInputV1({ ...draft(), operations: [] })).toEqual({
      ...draft(),
      operations: [],
    });
    for (const value of [
      { ...draft(), siteId: "other" },
      { ...draft(), draftHash: hash },
      { ...draft(), operations: [{ ...operation(), kind: "plugin" }] },
      {
        ...draft(),
        operations: [
          { ...operation(), resource: { collection: "posts", documentId: "temporary" } },
        ],
      },
      { ...draft(), operations: [operation(), operation()] },
    ])
      expect(npAnalyzeAgentChangeSetDraftInputV1(value).ok).toBe(false);
  });
  it("bounds total operations, collections, text and nested JSON and does not execute accessors", () => {
    expect(
      npAnalyzeAgentChangeSetDraftInputV1({
        ...draft(),
        operations: Array.from({ length: 501 }, (_, i) => ({
          ...operation(),
          clientOperationId: `op${i}`,
        })),
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetDraftInputV1({
        ...draft(),
        operations: Array.from({ length: 65 }, (_, i) => ({
          ...operation(),
          clientOperationId: `op${i}`,
          resource: { collection: `collection-${i}`, documentId: null },
        })),
      }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentChangeSetDraftInputV1({ ...draft(), title: "a".repeat(4001) }).ok).toBe(
      false,
    );
    let called = false;
    expect(
      npAnalyzeAgentChangeSetDraftInputV1({
        get title() {
          called = true;
          return "unsafe";
        },
        summary: null,
        operations: [],
      }).ok,
    ).toBe(false);
    expect(called).toBe(false);
    const shared = { x: 1 };
    expect(
      npAnalyzeAgentChangeSetDraftInputV1({
        ...draft(),
        operations: [
          { ...operation(), input: { document: { a: shared, b: shared }, targetStatus: "draft" } },
        ],
      }).ok,
    ).toBe(false);
  });
  it("keeps the existing Admin envelope and canonicalizes only verified proposal content", async () => {
    const request = {
      idempotencyKey: "request-1",
      proposalJson: JSON.stringify(draft(), null, 2),
      proposalHash: await npDigestAgentChangeSetDraftInputV1(draft()),
    };
    expect(npRequireAgentChangeSetAdminInputV1("create", request)).toEqual(request);
    expect(
      (await npVerifyAgentChangeSetAdminProposalV1("create", request)).request.proposalJson,
    ).toBe(npBuildAgentChangeSetDraftInputJsonV1(draft()));
    expect(
      npRequireAgentChangeSetAdminInputV1("update", { ...request, expectedVersion: 1 }),
    ).toMatchObject({ expectedVersion: 1 });
    for (const bad of [
      { ...request, expectedVersion: 1 },
      { ...request, expectedDraftHash: hash },
      { ...request, rowVersion: 1 },
      { ...request, idempotencyKey: "white space" },
    ])
      expect(() => npRequireAgentChangeSetAdminInputV1("create", bad)).toThrow();
    expect(() => npRequireAgentChangeSetAdminInputV1("update", request)).toThrow();
    await expect(
      npVerifyAgentChangeSetAdminProposalV1("create", { ...request, proposalHash: hash }),
    ).rejects.toThrow();
    await expect(
      npVerifyAgentChangeSetAdminProposalV1("create", { ...request, proposalJson: "{" }),
    ).rejects.toThrow();
  });
  it("projects exact editable operations with reserved identity but excludes sealed/snapshot/integrity facts", () => {
    expect(npRequireAgentChangeSetWire(wire())).toEqual(wire());
    for (const key of npAgentChangeSetWireExcludedKeysV1)
      expect(npAnalyzeAgentChangeSetWire({ ...wire(), [key]: "private" }).ok, key).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        operations: [{ ...wire().operations[0], beforeSnapshot: { value: "private" } }],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({ ...wire(), actor: { ...wire().actor, kind: "runtime" } }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentChangeSetWire({ ...wire(), state: "complete" }).ok).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        planHash: hash,
        baseFingerprint: hash,
        risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        operations: [
          {
            ...wire().operations[0],
            canonicalResourceKey: { kind: "document", collection: "other", documentId: resourceId },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  it("retains deleted staff attribution without inventing a live user UUID", () => {
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        actor: { id: hash, kind: "staff", name: "Deleted staff" },
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        actor: { id: hash, kind: "external", name: "External" },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({
        ...wire(),
        actor: { id: "missing-user", kind: "staff", name: "Deleted staff" },
      }).ok,
    ).toBe(false);
  });
  it("accepts declared sealed metadata without treating it as permission to apply", () => {
    const value = {
      ...wire(),
      state: "ready",
      planHash: hash,
      baseFingerprint: hash,
      risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
      validation: {
        state: "valid",
        generation: 1,
        issueCount: 0,
        digest: hash,
        completedAt: "2026-09-08T00:00:00.000Z",
      },
      operations: [{ ...wire().operations[0], state: "valid", afterHash: hash }],
    };
    expect(npAnalyzeAgentChangeSetWire(value).ok).toBe(true);
    expect(npAnalyzeAgentChangeSetWire({ ...value, validation: null }).ok).toBe(false);
    expect(npAnalyzeAgentChangeSetWire({ ...value, state: "applying" }).ok).toBe(false);
    expect(npAnalyzeAgentChangeSetWire({ ...value, state: "approved" }).ok).toBe(false);
    expect(
      npAnalyzeAgentChangeSetWire({ ...value, preview: { state: "ready", locator: "private" } }).ok,
    ).toBe(false);
  });
  it("shares one redacted approval projection and locks decision/lifetime matrices", () => {
    expect(npAnalyzeAgentApprovalWire(approval()).ok).toBe(true);
    for (const value of [
      { ...approval(), statementBody: {} },
      { ...approval(), challenge: "private" },
      { ...approval(), state: "approved" },
      { ...approval(), state: "pending", decidedAt: "2026-09-08T01:00:00.000Z" },
      { ...approval(), expiresAt: "2026-09-16T00:00:00.000Z" },
      { ...approval(), requiredHumanCapabilities: ["agent:approve"] },
      { ...approval(), requiredHumanPredicates: ["is-admin"] },
    ])
      expect(npAnalyzeAgentApprovalWire(value).ok).toBe(false);
    expect(
      npAnalyzeAgentApprovalWire({
        ...approval(),
        state: "approved",
        decidedAt: "2026-09-08T01:00:00.000Z",
      }).ok,
    ).toBe(true);
  });
});
