import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  NpAgentRestrictionAdapter,
  NpAgentRestrictionCheckV1,
} from "@nexpress/core/agent-contract";
import { createAgentGuardianActorProjectionV1 } from "../../../../core/src/agent/guardian-actor-projection.js";
import { npAgentRestrictionSubjectKeyV1 } from "../../../../core/src/agent-contract/restriction-adapter-contract.js";

vi.mock(
  "@nexpress/core/agents",
  () => import("../../../../core/src/agent/guardian-actor-projection.js"),
);
vi.mock(
  "@nexpress/core/agent-contract",
  () => import("../../../../core/src/agent-contract/restriction-adapter-contract.js"),
);

import {
  npCreateAgentGuardianRequestEnforcerV1,
  npResolveGuardianRequestScopeV1,
} from "./guardian-request-enforcer.js";

const instant = new Date("2026-10-18T00:00:00.000Z");
const digest = `cj1:sha256:${"A".repeat(43)}`;
const restrictionId = "00000000-0000-4000-8000-000000000001";
const oldKey = { id: "key-old", bytes: new Uint8Array(32).fill(7) };
const newKey = { id: "key-new", bytes: new Uint8Array(32).fill(8) };
const oldProjection = createAgentGuardianActorProjectionV1(oldKey);
const oldRef = {
  purpose: "network-address" as const,
  projectionVersion: oldProjection.projectionVersion,
  projectionFingerprint: oldProjection.projectionFingerprint,
  keyId: oldKey.id,
};
const request = (path = "/api/auth/login", method = "POST") =>
  new NextRequest(`https://public.example${path}`, {
    method,
    headers: { "x-np-admin-site": "another-site", "x-forwarded-for": "untrusted" },
  });
function fixture() {
  const check = vi.fn((_request: NpAgentRestrictionCheckV1) =>
    Promise.resolve({
      schemaVersion: "np.agent-restriction-decision.v1" as const,
      decision: "allow" as const,
      restrictionId: null,
      matchedSubjectKey: null,
      expiresAt: null,
      resultDigest: digest,
    }),
  );
  const adapter: NpAgentRestrictionAdapter = {
    id: "test.shared",
    contractVersion: 1,
    fingerprint: digest,
    sharedAcrossReplicas: true,
    install: vi.fn(),
    remove: vi.fn(),
    verify: vi.fn(),
    check,
    healthCheck: vi.fn(() =>
      Promise.resolve({
        schemaVersion: "np.agent-restriction-health.v1" as const,
        status: "ready" as const,
        sharedAcrossReplicas: true,
        checkedAt: instant.toISOString(),
        safeCodes: [],
      }),
    ),
  };
  const options = {
    adapter,
    currentKeyId: newKey.id,
    actorKeys: [oldKey, newKey],
    ensureReady: vi.fn((): Promise<void> => Promise.resolve()),
    resolveRequest: vi.fn(() =>
      Promise.resolve({ siteId: "trusted-site", networkAddress: "203.0.113.8" }),
    ),
    resolveActiveProjectionRefs: vi.fn(() => Promise.resolve([oldRef])),
    onDegraded: vi.fn(),
    now: () => instant,
  };
  return { options, check };
}
afterEach(() => vi.useRealTimers());

describe("explicit Guardian request enforcement", () => {
  it("maps only declared mutation scopes and leaves recovery and read requests alone", async () => {
    const { options } = fixture();
    const guard = npCreateAgentGuardianRequestEnforcerV1(options);
    for (const [path, method] of [
      ["/api/auth/login", "GET"],
      ["/api/auth/logout", "POST"],
      ["/api/auth/reset-password", "POST"],
      ["/api/plugins/custom/private", "POST"],
      ["/api/admin/agents/incidents/id/guardian-response/execute", "POST"],
    ])
      expect(await guard(request(path, method))).toBeNull();
    expect(options.ensureReady).not.toHaveBeenCalled();
    for (const [path, scope] of [
      ["/api/auth/login", "auth.staff"],
      ["/api/members/refresh", "auth.member"],
      ["/api/mcp", "agent.gateway"],
      ["/api/collections/posts/id/comments", "community.write"],
      ["/api/collections/posts/id", "content.write"],
    ])
      expect(npResolveGuardianRequestScopeV1(request(path))).toBe(scope);
  });

  it("derives both current and frozen same-site network candidates and accepts only the matched deny", async () => {
    const { options } = fixture();
    const check = vi.fn((input: NpAgentRestrictionCheckV1) => {
      const old = input.subjects.find(
        (subject) => subject.kind === "opaque_actor_bucket" && subject.keyId === oldKey.id,
      );
      if (!old) throw new Error("Old projection was lost.");
      return Promise.resolve({
        schemaVersion: "np.agent-restriction-decision.v1" as const,
        decision: "deny" as const,
        restrictionId,
        matchedSubjectKey: npAgentRestrictionSubjectKeyV1(old),
        expiresAt: "2026-10-18T00:01:00.000Z",
        resultDigest: digest,
      });
    });
    options.adapter.check = check;
    const result = await npCreateAgentGuardianRequestEnforcerV1(options)(request());
    expect(result).toEqual({
      schemaVersion: "np.agent-guardian-request-denial.v1",
      restrictionId,
      expiresAt: "2026-10-18T00:01:00.000Z",
    });
    expect(check).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        siteId: "trusted-site",
        actionScope: "auth.staff",
        subjects: expect.any(Array),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(check.mock.calls[0][0].subjects).toHaveLength(2);
    expect(JSON.stringify(check.mock.calls)).not.toContain("203.0.113.8");
    expect(JSON.stringify(check.mock.calls)).not.toContain("another-site");
    expect(options.onDegraded).not.toHaveBeenCalled();
  });

  it("falls back when a frozen projection/key or complete candidate coverage is unavailable", async () => {
    const { options, check } = fixture();
    options.resolveActiveProjectionRefs.mockResolvedValueOnce([
      { ...oldRef, keyId: "missing-key" },
    ]);
    const guard = npCreateAgentGuardianRequestEnforcerV1(options);
    expect(await guard(request())).toBeNull();
    options.resolveActiveProjectionRefs.mockResolvedValueOnce(
      Array.from({ length: 9 }, () => oldRef),
    );
    expect(await guard(request())).toBeNull();
    expect(check).not.toHaveBeenCalled();
    expect(options.onDegraded).toHaveBeenCalledTimes(2);
  });

  it("contains adapter failure and rejects an unrelated or expired denial", async () => {
    const { options } = fixture();
    options.adapter.check = vi.fn(() =>
      Promise.resolve({
        schemaVersion: "np.agent-restriction-decision.v1" as const,
        decision: "deny" as const,
        restrictionId,
        matchedSubjectKey: "principal:v1:member:00000000-0000-4000-8000-000000000002",
        expiresAt: "2026-10-18T00:01:00.000Z",
        resultDigest: digest,
      }),
    );
    const guard = npCreateAgentGuardianRequestEnforcerV1(options);
    expect(await guard(request())).toBeNull();
    options.adapter.check = vi.fn(() => Promise.reject(new Error("private backend details")));
    expect(await guard(request())).toBeNull();
    expect(options.onDegraded.mock.calls).toEqual([
      [{ code: "GUARDIAN_ENFORCEMENT_UNAVAILABLE" }],
      [{ code: "GUARDIAN_ENFORCEMENT_UNAVAILABLE" }],
    ]);
  });

  it("bounds an unavailable host and admits no more than four outstanding operations", async () => {
    vi.useFakeTimers();
    const { options } = fixture();
    options.ensureReady = vi.fn(() => new Promise<void>(() => undefined));
    const guard = npCreateAgentGuardianRequestEnforcerV1(options);
    const pending = Array.from({ length: 4 }, () => guard(request()));
    expect(await guard(request())).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(await Promise.all(pending)).toEqual([null, null, null, null]);
    expect(await guard(request())).toBeNull();
    expect(options.ensureReady).toHaveBeenCalledTimes(4);
    expect(options.resolveRequest).not.toHaveBeenCalled();
  });
});
