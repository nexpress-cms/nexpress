import { describe, expect, it } from "vitest";

import {
  npAgentAuthorizationContextCanonicalExcludedKeysV1,
  npAgentAuthorizationContextCanonicalIncludedKeysV1,
  npAgentAuthorizationContextCanonicalOauthGrantIncludedKeysV1,
  npAgentAuthorizationContextCanonicalPrincipalActorIncludedKeysV1,
  npAgentAuthorizationContextCanonicalRuntimeRunIncludedKeysV1,
  npAgentAuthorizationContextCanonicalServiceFamilyIncludedKeysV1,
  npAgentAuthorizationContextCanonicalStaffActorIncludedKeysV1,
  npAgentAuthorizationContextCanonicalStaffSessionIncludedKeysV1,
  npAnalyzeAgentAuthorizationContextCanonical,
  npBuildAgentAuthorizationContextCanonicalBytes,
  npDigestAgentAuthorizationContextCanonical,
  npRequireAgentAuthorizationContextCanonical,
} from "./index.js";

const decoder = new TextDecoder();
const siteAuthorizationDigest = "cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c";

const staff = {
  schemaVersion: "np.agent-authorization-context.v1",
  siteId: "docs-site",
  actor: {
    kind: "staff",
    userId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
    actorFingerprint: "sha256:staff-actor-v1",
  },
  transport: "admin",
  gatewayExposure: null,
  authorityRef: {
    kind: "staff-session",
    userId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
    sessionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
    userTokenVersion: 0,
    siteAuthorizationDigest,
  },
} as const;

const service = {
  schemaVersion: "np.agent-authorization-context.v1",
  siteId: "docs-site",
  actor: {
    kind: "principal",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
    actorFingerprint: "sha256:service-actor-v1",
  },
  transport: "agent-api",
  gatewayExposure: "propose",
  authorityRef: {
    kind: "service-family",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
    rotationFamilyId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd4",
    familyAuthorityVersion: 2,
    principalTokenVersion: 5,
    exposureMode: "propose",
    audience: "https://gateway.example.com/api/agent/v1",
  },
} as const;

const oauth = {
  schemaVersion: "np.agent-authorization-context.v1",
  siteId: "docs-site",
  actor: {
    kind: "principal",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd5",
    actorFingerprint: "sha256:oauth-actor-v1",
  },
  transport: "mcp-oauth",
  gatewayExposure: "read",
  authorityRef: {
    kind: "oauth-grant",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd5",
    clientId: "client_public_01",
    grantId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd6",
    grantVersion: 3,
    principalTokenVersion: 4,
    exposureMode: "read",
    audience: "https://gateway.example.com/api/mcp",
  },
} as const;

const runtime = {
  schemaVersion: "np.agent-authorization-context.v1",
  siteId: "docs-site",
  actor: {
    kind: "principal",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd7",
    actorFingerprint: "sha256:runtime-actor-v1",
  },
  transport: "runtime",
  gatewayExposure: null,
  authorityRef: {
    kind: "runtime-run",
    principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd7",
    runId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd8",
    agentVersionId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd9",
    deadlineAt: "2026-08-22T12:34:56.789Z",
  },
} as const;

describe("Agent authorization-context canonical body", () => {
  it("publishes exact top-level, excluded, actor, and authority branch fixtures", () => {
    expect(npAgentAuthorizationContextCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "actor",
      "transport",
      "gatewayExposure",
      "authorityRef",
    ]);
    expect(npAgentAuthorizationContextCanonicalExcludedKeysV1).toEqual([
      "authorizationContextFingerprint",
      "requestHash",
      "invocationId",
      "idempotencyKey",
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
    expect(npAgentAuthorizationContextCanonicalPrincipalActorIncludedKeysV1).toEqual([
      "kind",
      "principalId",
      "actorFingerprint",
    ]);
    expect(npAgentAuthorizationContextCanonicalStaffActorIncludedKeysV1).toEqual([
      "kind",
      "userId",
      "actorFingerprint",
    ]);
    expect(npAgentAuthorizationContextCanonicalStaffSessionIncludedKeysV1).toEqual([
      "kind",
      "userId",
      "sessionId",
      "userTokenVersion",
      "siteAuthorizationDigest",
    ]);
    expect(npAgentAuthorizationContextCanonicalServiceFamilyIncludedKeysV1).toEqual([
      "kind",
      "principalId",
      "rotationFamilyId",
      "familyAuthorityVersion",
      "principalTokenVersion",
      "exposureMode",
      "audience",
    ]);
    expect(npAgentAuthorizationContextCanonicalOauthGrantIncludedKeysV1).toEqual([
      "kind",
      "principalId",
      "clientId",
      "grantId",
      "grantVersion",
      "principalTokenVersion",
      "exposureMode",
      "audience",
    ]);
    expect(npAgentAuthorizationContextCanonicalRuntimeRunIncludedKeysV1).toEqual([
      "kind",
      "principalId",
      "runId",
      "agentVersionId",
      "deadlineAt",
    ]);
  });

  it("accepts every exact authority matrix branch and returns safe copies", () => {
    const stdio = {
      ...service,
      transport: "stdio",
      authorityRef: {
        ...service.authorityRef,
        audience: "urn:nexpress:agent-gateway:stdio",
      },
    } as const;
    const mcpService = {
      ...service,
      transport: "mcp-service",
      authorityRef: {
        ...service.authorityRef,
        audience: "https://gateway.example.com/api/mcp",
      },
    } as const;

    for (const value of [staff, service, stdio, mcpService, oauth, runtime]) {
      expect(npAnalyzeAgentAuthorizationContextCanonical(value).ok).toBe(true);
    }

    const copy = npRequireAgentAuthorizationContextCanonical(service);
    expect(copy).toEqual(service);
    expect(copy).not.toBe(service);
    expect(copy.actor).not.toBe(service.actor);
    expect(copy.authorityRef).not.toBe(service.authorityRef);
  });

  it("fails closed on matrix mismatches, noncanonical values, and branch leakage", () => {
    const invalid = [
      { ...service, transport: "mcp-service" },
      { ...service, gatewayExposure: "read" },
      {
        ...service,
        actor: { ...service.actor, principalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bda" },
      },
      {
        ...service,
        authorityRef: { ...service.authorityRef, familyAuthorityVersion: 0 },
      },
      {
        ...service,
        authorityRef: {
          ...service.authorityRef,
          audience: "https://gateway.example.com:443/api/agent/v1",
        },
      },
      {
        ...oauth,
        authorityRef: {
          ...oauth.authorityRef,
          audience: "https://gateway.example.com/api/agent/v1",
        },
      },
      { ...runtime, gatewayExposure: "read" },
      {
        ...runtime,
        authorityRef: { ...runtime.authorityRef, deadlineAt: "2026-08-22T12:34:56Z" },
      },
      {
        ...staff,
        authorityRef: { ...staff.authorityRef, siteAuthorizationDigest: "sha256:invalid" },
      },
      {
        ...staff,
        authorityRef: { ...staff.authorityRef, principalId: service.actor.principalId },
      },
      { ...staff, authorizationContextFingerprint: "forbidden" },
    ];

    invalid.forEach((value) => {
      expect(npAnalyzeAgentAuthorizationContextCanonical(value).ok).toBe(false);
    });
  });

  it("never invokes accessors or Proxy get traps", () => {
    let reads = 0;
    const accessor = { ...staff.actor } as Record<string, unknown>;
    Object.defineProperty(accessor, "userId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("secret accessor");
      },
    });
    expect(npAnalyzeAgentAuthorizationContextCanonical({ ...staff, actor: accessor }).ok).toBe(
      false,
    );
    expect(reads).toBe(0);

    const authorityProxy = new Proxy(service.authorityRef, {
      get() {
        reads += 1;
        throw new Error("secret get trap");
      },
    });
    expect(
      npAnalyzeAgentAuthorizationContextCanonical({ ...service, authorityRef: authorityProxy }).ok,
    ).toBe(true);
    expect(reads).toBe(0);
  });

  it("emits independent canonical-byte and SHA-256 golden vectors", async () => {
    const vectors = [
      {
        value: staff,
        json: '{"actor":{"actorFingerprint":"sha256:staff-actor-v1","kind":"staff","userId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1"},"authorityRef":{"kind":"staff-session","sessionId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd2","siteAuthorizationDigest":"cj1:sha256:vYfQk83RNi-TVzHbdfwd-UbSoeJEj8pwk0iDT2qZC4c","userId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd1","userTokenVersion":0},"gatewayExposure":null,"schemaVersion":"np.agent-authorization-context.v1","siteId":"docs-site","transport":"admin"}',
        expectedDigest: "cj1:sha256:vhKqKpONrATswReshTTxp0InhMEMijjpbdlDTaMfGyo",
      },
      {
        value: service,
        json: '{"actor":{"actorFingerprint":"sha256:service-actor-v1","kind":"principal","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3"},"authorityRef":{"audience":"https://gateway.example.com/api/agent/v1","exposureMode":"propose","familyAuthorityVersion":2,"kind":"service-family","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd3","principalTokenVersion":5,"rotationFamilyId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd4"},"gatewayExposure":"propose","schemaVersion":"np.agent-authorization-context.v1","siteId":"docs-site","transport":"agent-api"}',
        expectedDigest: "cj1:sha256:rP88zcaVSPM1GWxegVKrXg9RDnwQh1X6w_ZuXZ_ZwlU",
      },
      {
        value: oauth,
        json: '{"actor":{"actorFingerprint":"sha256:oauth-actor-v1","kind":"principal","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd5"},"authorityRef":{"audience":"https://gateway.example.com/api/mcp","clientId":"client_public_01","exposureMode":"read","grantId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd6","grantVersion":3,"kind":"oauth-grant","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd5","principalTokenVersion":4},"gatewayExposure":"read","schemaVersion":"np.agent-authorization-context.v1","siteId":"docs-site","transport":"mcp-oauth"}',
        expectedDigest: "cj1:sha256:qV9I0A4SvfEk_OSur8EuIVl-vpzFOvj8Zn7smUvpCrs",
      },
      {
        value: runtime,
        json: '{"actor":{"actorFingerprint":"sha256:runtime-actor-v1","kind":"principal","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd7"},"authorityRef":{"agentVersionId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd9","deadlineAt":"2026-08-22T12:34:56.789Z","kind":"runtime-run","principalId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd7","runId":"018f0f30-cd7b-7cc2-8b16-8c052c259bd8"},"gatewayExposure":null,"schemaVersion":"np.agent-authorization-context.v1","siteId":"docs-site","transport":"runtime"}',
        expectedDigest: "cj1:sha256:n2bZLGfVlXCl6P3hTPcDY_tYjuqejYgM0Ebfh3Q6LwA",
      },
    ];

    for (const { value, json, expectedDigest } of vectors) {
      const bytes = npBuildAgentAuthorizationContextCanonicalBytes(value);
      expect(decoder.decode(bytes.canonicalJsonUtf8)).toBe(json);
      expect(decoder.decode(bytes.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0np.agent-authorization-context.v1\0${json}`,
      );
      expect(await npDigestAgentAuthorizationContextCanonical(value)).toBe(expectedDigest);
    }
  });
});
