import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentActivityServiceV1 } from "./activity-service.js";
import type * as AdminAdmission from "./admin-admission.js";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  resolve: vi.fn<() => Promise<string | null>>(),
  staff: vi.fn(),
  collection: vi.fn(),
}));
vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.rows.shift() ?? []) }) }),
    }),
  }),
}));
vi.mock("./source-release-read.js", () => ({
  npResolveReleasedAgentActionPrincipalV1: mocks.resolve,
}));
vi.mock("./admin-admission.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminAdmission>()),
  npResolveAgentStaffSessionAuthorizationV1: mocks.staff,
}));
vi.mock("../collections/index.js", () => ({
  getCollectionConfig: mocks.collection,
  findDocuments: vi.fn(),
}));

const id = "11111111-1111-4111-8111-111111111111";
const invocationId = "22222222-2222-4222-8222-222222222222";
const principalId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const now = new Date("2026-09-16T00:00:00.000Z");
const input = {
  siteId: "activity-release",
  id,
  actor: {
    user: {
      id,
      name: "Admin",
      email: "admin@example.test",
      role: "admin" as const,
      tokenVersion: 1,
    },
    sessionId: invocationId,
  },
};
function action(overrides: Record<string, unknown> = {}) {
  return {
    id,
    siteId: input.siteId,
    invocationId,
    runId: null,
    runFingerprint: digest,
    runSourceReleaseId: releaseId,
    requiredScopes: ["site:read"],
    capabilityId: "site.inspect",
    capabilityContractVersion: 1,
    capabilityFingerprint: digest,
    effectProfileId: "read",
    effectContractVersion: 1,
    sequence: 1,
    risk: "read",
    state: "succeeded",
    targetRefs: [],
    inputCanonical: {},
    inputHash: digest,
    outputHash: digest,
    auditEventId: null,
    approvalId: null,
    verificationState: null,
    errorCode: null,
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    ...overrides,
  };
}
function invocation(overrides: Record<string, unknown> = {}) {
  return {
    id: invocationId,
    principalId,
    expiresAt: new Date("2026-09-17T00:00:00.000Z"),
    ...overrides,
  };
}
const service = () =>
  createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(32).fill(8), now: () => now });
beforeEach(() => {
  mocks.rows = [];
  mocks.resolve.mockReset().mockResolvedValue(principalId);
  mocks.staff.mockReset().mockResolvedValue({
    authority: { kind: "super-admin", capabilities: ["admin.manage", "site.access"] },
  });
  mocks.collection.mockReset();
});

describe("Activity source-release attribution boundary", () => {
  it("projects verified released history through the existing expired, redacted wire", async () => {
    mocks.rows = [[action()], [invocation()]];
    const detail = await service().getAction(input);
    expect(detail).toMatchObject({
      principalId,
      evidence: "expired",
      inputHash: digest,
      action: { id, runId: null, inputRedacted: {}, outputRedacted: {} },
    });
    expect(JSON.stringify(detail)).not.toContain(releaseId);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.staff).toHaveBeenCalledTimes(2);
  });

  it.each([null, "55555555-5555-4555-8555-555555555555"])(
    "does not fall back to invocation ownership for invalid receipt principal %s",
    async (owner) => {
      mocks.resolve.mockResolvedValue(owner);
      mocks.rows = [[action()], [invocation()]];
      await expect(service().getAction(input)).rejects.toMatchObject({
        code: "ACTIVITY_NOT_FOUND",
        status: 404,
      });
    },
  );

  it("redacts receipt verifier failures", async () => {
    mocks.resolve.mockRejectedValue(new Error("private receipt evidence"));
    mocks.rows = [[action()], [invocation()]];
    await expect(service().getAction(input)).rejects.toMatchObject({
      code: "ACTIVITY_NOT_FOUND",
      message: "Activity is unavailable.",
    });
  });

  it.each([
    { runSourceReleaseId: null },
    { runId: id },
    { runFingerprint: null },
    { invocationId: null },
  ])("denies malformed released attribution %j before resolving receipts", async (overrides) => {
    mocks.rows = [[action(overrides)], [invocation()]];
    await expect(service().getAction(input)).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("preserves never-attributed invocation history without treating it as released", async () => {
    mocks.rows = [[action({ runFingerprint: null, runSourceReleaseId: null })], [invocation()]];
    expect(await service().getAction(input)).toMatchObject({ principalId, evidence: "redacted" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("applies current collection ACL before revealing released history", async () => {
    mocks.rows = [
      [action({ capabilityId: "content.query", inputCanonical: { collection: "private" } })],
    ];
    mocks.collection.mockReturnValue({ access: { read: () => false } });
    await expect(service().getAction(input)).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rechecks current staff access after resolving retained evidence", async () => {
    mocks.rows = [[action()], [invocation()]];
    mocks.staff.mockResolvedValueOnce({
      authority: { kind: "super-admin", capabilities: ["admin.manage", "site.access"] },
    });
    mocks.staff.mockResolvedValue({ authority: { kind: "super-admin", capabilities: [] } });
    await expect(service().getAction(input)).rejects.toMatchObject({ code: "ACTIVITY_FORBIDDEN" });
  });
});
