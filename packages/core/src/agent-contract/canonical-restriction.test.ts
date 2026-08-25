import { describe, expect, it, vi } from "vitest";

import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  NpAgentContractError,
  npAgentActorBucketPurposesV1,
  npAgentActorRestrictionScopes,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentContractLimits,
  npAgentRestrictionAuthenticatedPrincipalSubjectIncludedKeysV1,
  npAgentRestrictionCanonicalExcludedKeysV1,
  npAgentRestrictionCanonicalIncludedKeysV1,
  npAgentRestrictionOpaqueActorBucketSubjectIncludedKeysV1,
  npAgentRestrictionPrincipalKinds,
  npAnalyzeAgentRestrictionCanonical,
  npBuildAgentRestrictionCanonicalBytes,
  npDigestAgentRestrictionCanonical,
  npRequireAgentRestrictionCanonical,
  type NpAgentContractResult,
  type NpAgentRestrictionCanonicalV1,
  type NpAgentRestrictionDescriptorV1,
} from "./index.js";

const decoder = new TextDecoder();
const restrictionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const principalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const actorBucket = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const goldenDigest = "cj1:sha256:ClygUrexKpScaMktLwoS0Hg407kVBM0wTng-ktsTOsQ";

function authenticatedRestriction(
  overrides: Partial<NpAgentRestrictionCanonicalV1> = {},
): NpAgentRestrictionCanonicalV1 {
  return {
    schemaVersion: "np.agent-restriction.v1",
    restrictionId,
    siteId: "docs-site",
    subject: {
      kind: "authenticated_principal",
      principalKind: "agent-gateway",
      principalId,
    },
    actionScopes: ["agent.gateway", "auth.staff"],
    startsAt: "2026-08-25T01:00:00.000Z",
    expiresAt: "2026-08-25T01:15:00.000Z",
    reasonCode: "SECURITY_LOGIN_VELOCITY",
    targetVersionDigest: digestA,
    ...overrides,
  };
}

function opaqueRestriction(
  overrides: Partial<NpAgentRestrictionCanonicalV1> = {},
): NpAgentRestrictionCanonicalV1 {
  return authenticatedRestriction({
    subject: {
      kind: "opaque_actor_bucket",
      purpose: "network-address",
      projectionVersion: 2,
      projectionFingerprint: "sha256:actor-bucket-projection-v2",
      keyId: "actor-bucket.k2026_08",
      bucket: actorBucket,
    },
    actionScopes: ["auth.member", "community.write"],
    reasonCode: "SECURITY_NETWORK_VELOCITY",
    ...overrides,
  });
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent restriction canonical body", () => {
  it("publishes the closed inventories, bounds, and exact field fixtures", () => {
    expect(npAgentActorBucketPurposesV1).toEqual(["login-identifier", "network-address"]);
    expect(npAgentActorRestrictionScopes).toEqual([
      "auth.staff",
      "auth.member",
      "agent.gateway",
      "community.write",
      "content.write",
    ]);
    expect(npAgentRestrictionPrincipalKinds).toEqual(["agent-gateway", "member", "staff"]);
    expect(NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS).toBe(60);
    expect(NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS).toBe(15 * 60);
    expect(NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS).toBe(60 * 60);
    expect(npAgentContractLimits.actorRestrictionTtlMinimumSeconds).toBe(
      NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
    );
    expect(npAgentContractLimits.actorRestrictionTtlDefaultSeconds).toBe(
      NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS,
    );
    expect(npAgentContractLimits.actorRestrictionTtlMaximumSeconds).toBe(
      NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
    );
    expect(npAgentRestrictionCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "restrictionId",
      "siteId",
      "subject",
      "actionScopes",
      "startsAt",
      "expiresAt",
      "reasonCode",
      "targetVersionDigest",
    ]);
    expect(npAgentRestrictionCanonicalExcludedKeysV1).toEqual([
      "restrictionHash",
      "status",
      "containmentId",
      "actionId",
      "incidentId",
      "enforcementAdapter",
      "enforcementAdapterContractVersion",
      "enforcementAdapterFingerprint",
      "enforcementRef",
      "installReceipt",
      "removalReceipt",
      "lastErrorCode",
      "rowVersion",
      "createdAt",
      "updatedAt",
      "revokedAt",
    ]);
    expect(npAgentRestrictionAuthenticatedPrincipalSubjectIncludedKeysV1).toEqual([
      "kind",
      "principalKind",
      "principalId",
    ]);
    expect(npAgentRestrictionOpaqueActorBucketSubjectIncludedKeysV1).toEqual([
      "kind",
      "purpose",
      "projectionVersion",
      "projectionFingerprint",
      "keyId",
      "bucket",
    ]);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-restriction.v1"]).toBe(64 * 1024);
  });

  it("rebuilds independent authenticated and opaque descriptors", () => {
    const authenticated = authenticatedRestriction();
    const parsedAuthenticated = npRequireAgentRestrictionCanonical(authenticated);
    expect(parsedAuthenticated).toEqual(authenticated);
    expect(parsedAuthenticated).not.toBe(authenticated);
    expect(parsedAuthenticated.subject).not.toBe(authenticated.subject);
    expect(parsedAuthenticated.actionScopes).not.toBe(authenticated.actionScopes);

    const opaque = opaqueRestriction();
    const parsedOpaque = npRequireAgentRestrictionCanonical(opaque);
    expect(parsedOpaque).toEqual(opaque);
    expect(parsedOpaque.subject).not.toBe(opaque.subject);

    const descriptor: NpAgentRestrictionDescriptorV1 = parsedAuthenticated;
    const canonical: NpAgentRestrictionCanonicalV1 = descriptor;
    expect(canonical.schemaVersion).toBe("np.agent-restriction.v1");
  });

  it("enforces exact mutually exclusive subject branches", () => {
    expectIssue(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          subject: {
            ...authenticatedRestriction().subject,
            purpose: "network-address",
          } as never,
        }),
      ),
      "unknown-field",
      "agent.canonical.restriction.subject.purpose",
    );
    expect(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          subject: { kind: "authenticated_principal", principalKind: "staff" } as never,
        }),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRestrictionCanonical(
        opaqueRestriction({
          subject: {
            ...opaqueRestriction().subject,
            principalId,
          } as never,
        }),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          subject: {
            ...authenticatedRestriction().subject,
            principalKind: "service" as never,
          } as never,
        }),
      ).ok,
    ).toBe(false);
  });

  it("enforces canonical identities, bucket evidence, reason, and target digest", () => {
    const opaque = opaqueRestriction();
    const invalid = [
      authenticatedRestriction({ restrictionId: "not-a-uuid" }),
      authenticatedRestriction({ siteId: "Docs Site" }),
      authenticatedRestriction({
        subject: { ...authenticatedRestriction().subject, principalId: "not-a-uuid" } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, purpose: "device" as never } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, projectionVersion: 0 } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, projectionFingerprint: "unsafe\nvalue" } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, keyId: "INVALID KEY" } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, bucket: actorBucket.slice(1) } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, bucket: `${actorBucket.slice(1)}=` } as never,
      }),
      opaqueRestriction({
        subject: { ...opaque.subject, bucket: `${actorBucket.slice(0, -1)}B` } as never,
      }),
      authenticatedRestriction({ reasonCode: "security.login_velocity" }),
      authenticatedRestriction({ targetVersionDigest: digestA.replace("cj1", "sha256") }),
    ];
    for (const value of invalid) expect(npAnalyzeAgentRestrictionCanonical(value).ok).toBe(false);
  });

  it("requires sorted unique non-empty scopes and the inclusive TTL window", () => {
    expect(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          startsAt: "2026-08-25T01:00:00.000Z",
          expiresAt: "2026-08-25T01:01:00.000Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          actionScopes: [
            "agent.gateway",
            "auth.member",
            "auth.staff",
            "community.write",
            "content.write",
          ],
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRestrictionCanonical(
        authenticatedRestriction({
          startsAt: "2026-08-25T01:00:00.000Z",
          expiresAt: "2026-08-25T02:00:00.000Z",
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRestrictionCanonical(
        opaqueRestriction({
          subject: {
            ...opaqueRestriction().subject,
            projectionFingerprint: "p".repeat(256),
          } as never,
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentRestrictionCanonical(authenticatedRestriction({ reasonCode: "A".repeat(64) }))
        .ok,
    ).toBe(true);

    const invalid = [
      authenticatedRestriction({ actionScopes: [] }),
      authenticatedRestriction({ actionScopes: ["auth.staff", "agent.gateway"] }),
      authenticatedRestriction({ actionScopes: ["auth.staff", "auth.staff"] }),
      authenticatedRestriction({ actionScopes: ["auth.unknown" as never] }),
      authenticatedRestriction({ expiresAt: "2026-08-25T01:00:59.999Z" }),
      authenticatedRestriction({ expiresAt: "2026-08-25T02:00:00.001Z" }),
      authenticatedRestriction({ expiresAt: "2026-08-25" }),
      opaqueRestriction({
        subject: {
          ...opaqueRestriction().subject,
          projectionFingerprint: "p".repeat(257),
        } as never,
      }),
      authenticatedRestriction({ reasonCode: "A".repeat(65) }),
      authenticatedRestriction({ reasonCode: "1INVALID" }),
    ];
    for (const value of invalid) expect(npAnalyzeAgentRestrictionCanonical(value).ok).toBe(false);
  });

  it("rejects unknown, cyclic, accessor, and hostile Proxy input safely", () => {
    expect(
      npAnalyzeAgentRestrictionCanonical({
        ...authenticatedRestriction(),
        enforcementRef: "forbidden",
      }).ok,
    ).toBe(false);

    const cyclic = authenticatedRestriction() as unknown as Record<string, unknown>;
    cyclic.subject = cyclic;
    expect(npAnalyzeAgentRestrictionCanonical(cyclic).ok).toBe(false);

    const getter = vi.fn(() => "not-read");
    const accessor = authenticatedRestriction();
    Object.defineProperty(accessor, "reasonCode", { enumerable: true, get: getter });
    expect(npAnalyzeAgentRestrictionCanonical(accessor).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(authenticatedRestriction(), {
      getPrototypeOf() {
        throw new Error("contained");
      },
    });
    expect(npAnalyzeAgentRestrictionCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("locks the exact 64 KiB purpose ceiling before hashing", () => {
    const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-restriction.v1"];
    const exact = buildAgentCanonicalFoundationBytes("np.agent-restriction.v1", {
      x: "a".repeat(maximum - 8),
    });
    expect(exact.canonicalJsonUtf8).toHaveLength(maximum);
    expect(() =>
      buildAgentCanonicalFoundationBytes("np.agent-restriction.v1", {
        x: "a".repeat(maximum - 7),
      }),
    ).toThrow(NpAgentContractError);
  });

  it("locks source-key independence, domain separation, and the golden digest", async () => {
    const body = authenticatedRestriction();
    const reordered = {
      targetVersionDigest: body.targetVersionDigest,
      reasonCode: body.reasonCode,
      expiresAt: body.expiresAt,
      startsAt: body.startsAt,
      actionScopes: [...body.actionScopes],
      subject:
        body.subject.kind === "authenticated_principal"
          ? {
              principalId: body.subject.principalId,
              principalKind: body.subject.principalKind,
              kind: body.subject.kind,
            }
          : body.subject,
      siteId: body.siteId,
      restrictionId: body.restrictionId,
      schemaVersion: body.schemaVersion,
    };
    expect(serializeAgentCanonicalJson(reordered)).toBe(serializeAgentCanonicalJson(body));
    const built = npBuildAgentRestrictionCanonicalBytes(body);
    expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-restriction.v1\0${decoder.decode(built.canonicalJsonUtf8)}`,
    );
    expect(await npDigestAgentRestrictionCanonical(body)).toBe(goldenDigest);
    expect(await npDigestAgentRestrictionCanonical(reordered)).toBe(goldenDigest);
    expect(
      await npDigestAgentRestrictionCanonical(
        authenticatedRestriction({ targetVersionDigest: digestB }),
      ),
    ).not.toBe(goldenDigest);
  });
});
