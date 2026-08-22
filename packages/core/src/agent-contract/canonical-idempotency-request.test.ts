import { describe, expect, it } from "vitest";

import {
  npAgentContractLimits,
  npAgentInvocationRequestCanonicalEffectProfileIncludedKeysV1,
  npAgentInvocationRequestCanonicalExcludedKeysV1,
  npAgentInvocationRequestCanonicalIncludedKeysV1,
  npAnalyzeAgentInvocationRequestCanonical,
  npBuildAgentInvocationRequestCanonicalBytes,
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentInvocationRequestCanonical,
} from "./index.js";

const decoder = new TextDecoder();
const authorizationContextFingerprint = "cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c";
const capabilityContractFingerprint = "cj1:sha256:T21-Vl0kaDoz0ekrnmbocvF2d4RZbcwdB_WIPR8HXBk";
const adminContractFingerprint = "cj1:sha256:Nmsm86_pWg0eajtQDgFXhMSmJLUkr9rysW2BexPsQx8";

const capability = {
  schemaVersion: "np.agent-idempotency-request.v1",
  siteId: "docs-site",
  actorKind: "principal",
  actorFingerprint: "sha256:principal-actor-v1",
  authorizationContextFingerprint,
  operationKind: "capability",
  operationId: "changeset.apply",
  contractVersion: 3,
  contractFingerprint: capabilityContractFingerprint,
  effectProfile: {
    id: "changeset.apply.direct",
    contractVersion: 2,
  },
  input: {
    z: [3, { b: true, a: null }],
    a: { title: "Draft", count: -0 },
  },
} as const;

const admin = {
  schemaVersion: "np.agent-idempotency-request.v1",
  siteId: "docs-site",
  actorKind: "staff",
  actorFingerprint: "sha256:staff-actor-v1",
  authorizationContextFingerprint,
  operationKind: "admin",
  operationId: "agents.connections.create",
  contractVersion: 4,
  contractFingerprint: adminContractFingerprint,
  effectProfile: null,
  input: {
    vault: {
      requestDigest: capabilityContractFingerprint,
      secretVersionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      vaultOperationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
      kind: "vault-request",
    },
    enabled: true,
  },
} as const;

function withInput(input: unknown): Record<string, unknown> {
  return { ...capability, input };
}

describe("Agent invocation idempotency-request canonical body", () => {
  it("publishes exact top-level, nested, and excluded key fixtures", () => {
    expect(npAgentInvocationRequestCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "actorKind",
      "actorFingerprint",
      "authorizationContextFingerprint",
      "operationKind",
      "operationId",
      "contractVersion",
      "contractFingerprint",
      "effectProfile",
      "input",
    ]);
    expect(npAgentInvocationRequestCanonicalEffectProfileIncludedKeysV1).toEqual([
      "id",
      "contractVersion",
    ]);
    expect(npAgentInvocationRequestCanonicalExcludedKeysV1).toEqual([
      "requestHash",
      "idempotencyKey",
      "transport",
      "mcpExecutionMode",
      "mcpRequestedTaskTtlMs",
      "jsonRpcId",
      "requestId",
      "taskId",
      "invocationId",
      "state",
      "runId",
      "resultKind",
      "resultId",
      "outputRedacted",
      "outputHash",
      "auditEventId",
      "errorCode",
      "requestedAt",
      "completedAt",
      "expiresAt",
    ]);
  });

  it("accepts both exact operation branches and returns safe canonical copies", () => {
    for (const value of [capability, admin]) {
      expect(npAnalyzeAgentInvocationRequestCanonical(value).ok).toBe(true);
    }

    const copy = npRequireAgentInvocationRequestCanonical(capability);
    expect(copy).toEqual({
      ...capability,
      input: {
        z: [3, { b: true, a: null }],
        a: { title: "Draft", count: 0 },
      },
    });
    expect(copy).not.toBe(capability);
    expect(copy.effectProfile).not.toBe(capability.effectProfile);
    expect(copy.input).not.toBe(capability.input);
    expect(copy.input.a).not.toBe(capability.input.a);
  });

  it("fails closed on branch mismatch, noncanonical identities, and injected fields", () => {
    const invalid = [
      { ...capability, operationId: "plugin.unknown" },
      { ...capability, effectProfile: null },
      { ...admin, effectProfile: capability.effectProfile },
      { ...admin, operationId: "Agents/connections/create" },
      { ...capability, contractVersion: 0 },
      { ...capability, contractVersion: 1.5 },
      { ...capability, authorizationContextFingerprint: "sha256:invalid" },
      { ...capability, contractFingerprint: "cj1:sha256:short" },
      { ...capability, actorFingerprint: "" },
      { ...capability, actorFingerprint: "actor\nsecret" },
      { ...capability, requestHash: capabilityContractFingerprint },
      {
        ...capability,
        effectProfile: { ...capability.effectProfile, implementationVersion: 1 },
      },
      { ...capability, input: [] },
      { ...capability, input: null },
    ];

    for (const value of invalid) {
      expect(npAnalyzeAgentInvocationRequestCanonical(value).ok).toBe(false);
    }
  });

  it("enforces the invocation input depth, node, container, string, and body-byte limits", () => {
    let deep: unknown = null;
    for (let depth = 0; depth < npAgentContractLimits.invocationDepth + 1; depth += 1) {
      deep = { next: deep };
    }
    const tooManyNodes = {
      groups: Array.from({ length: 40 }, () => Array.from({ length: 500 }, () => 0)),
    };
    const tooManyProperties = Object.fromEntries(
      Array.from({ length: npAgentContractLimits.invocationObjectProperties + 1 }, (_, index) => [
        `key_${index.toString()}`,
        index,
      ]),
    );
    const tooManyArrayItems = {
      values: Array.from(
        { length: npAgentContractLimits.invocationArrayItems + 1 },
        (_, index) => index,
      ),
    };
    const tooLongString = {
      value: "x".repeat(npAgentContractLimits.invocationStringCharacters + 1),
    };
    const tooManyBytes = {
      chunks: Array.from({ length: 17 }, () =>
        "x".repeat(npAgentContractLimits.invocationStringCharacters),
      ),
    };

    for (const input of [
      deep,
      tooManyNodes,
      tooManyProperties,
      tooManyArrayItems,
      tooLongString,
      tooManyBytes,
    ]) {
      expect(npAnalyzeAgentInvocationRequestCanonical(withInput(input)).ok).toBe(false);
    }
  });

  it("accepts each exact invocation input boundary", () => {
    let maximumDepth: unknown = null;
    for (let depth = 0; depth < npAgentContractLimits.invocationDepth; depth += 1) {
      maximumDepth = { next: maximumDepth };
    }
    const maximumNodes = {
      groups: [
        ...Array.from({ length: 38 }, () => Array.from({ length: 512 }, () => 0)),
        Array.from({ length: 503 }, () => 0),
      ],
    };
    const maximumProperties = Object.fromEntries(
      Array.from({ length: npAgentContractLimits.invocationObjectProperties }, (_, index) => [
        `key_${index.toString()}`,
        index,
      ]),
    );

    for (const input of [
      maximumDepth,
      maximumNodes,
      maximumProperties,
      { values: Array.from({ length: npAgentContractLimits.invocationArrayItems }, () => 0) },
      { value: "x".repeat(npAgentContractLimits.invocationStringCharacters) },
    ]) {
      expect(npAnalyzeAgentInvocationRequestCanonical(withInput(input)).ok).toBe(true);
    }
  });

  it("inspects descriptors without invoking accessors or Proxy get traps", () => {
    let reads = 0;
    const proxiedInput = new Proxy(
      { nested: { value: "safe" } },
      {
        get() {
          reads += 1;
          throw new Error("hostile getter");
        },
      },
    );
    const proxiedRequest = new Proxy(
      { ...capability, input: proxiedInput },
      {
        get() {
          reads += 1;
          throw new Error("hostile getter");
        },
      },
    );

    expect(npRequireAgentInvocationRequestCanonical(proxiedRequest).input).toEqual({
      nested: { value: "safe" },
    });
    expect(reads).toBe(0);

    const accessorInput = {};
    Object.defineProperty(accessorInput, "secret", {
      enumerable: true,
      get() {
        reads += 1;
        return "do-not-read";
      },
    });
    expect(npAnalyzeAgentInvocationRequestCanonical(withInput(accessorInput)).ok).toBe(false);
    expect(reads).toBe(0);

    const hostile = new Proxy(capability, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(npAnalyzeAgentInvocationRequestCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("rejects cycles, shared references, sparse arrays, and non-I-JSON values", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = { value: true };
    const sparse = Array(1);

    for (const input of [
      cycle,
      { first: shared, second: shared },
      { sparse },
      { value: Number.NaN },
      { value: 1n },
      { value: "\ud800" },
    ]) {
      expect(npAnalyzeAgentInvocationRequestCanonical(withInput(input)).ok).toBe(false);
    }
  });

  it("emits stable domain-separated golden vectors for capability and Admin requests", async () => {
    const capabilityJson =
      '{"actorFingerprint":"sha256:principal-actor-v1","actorKind":"principal","authorizationContextFingerprint":"cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c","contractFingerprint":"cj1:sha256:T21-Vl0kaDoz0ekrnmbocvF2d4RZbcwdB_WIPR8HXBk","contractVersion":3,"effectProfile":{"contractVersion":2,"id":"changeset.apply.direct"},"input":{"a":{"count":0,"title":"Draft"},"z":[3,{"a":null,"b":true}]},"operationId":"changeset.apply","operationKind":"capability","schemaVersion":"np.agent-idempotency-request.v1","siteId":"docs-site"}';
    const adminJson =
      '{"actorFingerprint":"sha256:staff-actor-v1","actorKind":"staff","authorizationContextFingerprint":"cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c","contractFingerprint":"cj1:sha256:Nmsm86_pWg0eajtQDgFXhMSmJLUkr9rysW2BexPsQx8","contractVersion":4,"effectProfile":null,"input":{"enabled":true,"vault":{"kind":"vault-request","requestDigest":"cj1:sha256:T21-Vl0kaDoz0ekrnmbocvF2d4RZbcwdB_WIPR8HXBk","secretVersionId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd2","vaultOperationId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1"}},"operationId":"agents.connections.create","operationKind":"admin","schemaVersion":"np.agent-idempotency-request.v1","siteId":"docs-site"}';

    const vectors = [
      {
        value: capability,
        json: capabilityJson,
        expectedDigest: "cj1:sha256:bc7OMUfC_Umu008_xYHtz8MoPm0FTX5oQT0kbWz0Dkk",
      },
      {
        value: admin,
        json: adminJson,
        expectedDigest: "cj1:sha256:KKmqRofAQurGOnvfJb_BHhT06FLWZL13fGO0R_gQDXA",
      },
    ] as const;

    for (const { value, json, expectedDigest } of vectors) {
      const built = npBuildAgentInvocationRequestCanonicalBytes(value);
      expect(built.purpose).toBe("np.agent-idempotency-request.v1");
      expect(decoder.decode(built.canonicalJsonUtf8)).toBe(json);
      expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0np.agent-idempotency-request.v1\0${json}`,
      );
      expect(await npDigestAgentInvocationRequestCanonical(value)).toBe(expectedDigest);
    }
  });
});
