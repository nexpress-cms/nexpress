import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db/runtime.js";
import { npReadReleasedRunHistoryV1 } from "./released-run-history.js";

const mocks = vi.hoisted(() => ({ receipt: vi.fn(), principal: vi.fn() }));
vi.mock("./source-release-read.js", () => ({
  npRequireAgentSourceReleaseRecordV1: mocks.receipt,
  npResolveReleasedAgentActionPrincipalV1: mocks.principal,
}));
const id = "11111111-1111-4111-8111-111111111111";
const principalId = "22222222-2222-4222-8222-222222222222";
const releasedAt = "2026-09-18T00:00:00.000Z";
const body = {
  kind: "runtime-run",
  sourceId: id,
  siteId: "history",
  principalId,
  agentId: id,
  agentVersionId: id,
  state: "succeeded",
  finishedAt: "2026-09-01T00:00:00.000Z",
  releasedAt,
};
function fixture(rows: unknown[][]) {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows.shift() ?? []) }) }),
    }),
  } as unknown as ReturnType<typeof getDb>;
  const actionVisible = vi.fn().mockResolvedValue(true);
  return { db, siteId: "history", runId: id, actionVisible };
}
beforeEach(() => {
  mocks.receipt.mockReset().mockResolvedValue(body);
  mocks.principal.mockReset().mockResolvedValue(principalId);
});
describe("released Run historical projection", () => {
  it("projects only retained identity without reconstructing source execution fields", async () => {
    const result = await npReadReleasedRunHistoryV1(fixture([[{ id }], [], []]));
    expect(result).toEqual({
      schemaVersion: "np.agent-activity-run-expired.v1",
      runId: id,
      siteId: "history",
      principalId,
      agent: { id, versionId: id },
      state: "succeeded",
      finishedAt: body.finishedAt,
      releasedAt,
      evidence: "expired",
    });
  });
  it("requires every retained action attribution and current visibility", async () => {
    const f = fixture([[{ id }], [{ ownerId: id, edgeCode: "action-run" }], [{ id }]]);
    expect(await npReadReleasedRunHistoryV1(f)).not.toBeNull();
    expect(mocks.principal).toHaveBeenCalledOnce();
    expect(f.actionVisible).toHaveBeenCalledOnce();
  });
  it("denies current action ACL loss", async () => {
    const f = fixture([[{ id }], [{ ownerId: id, edgeCode: "action-run" }], [{ id }]]);
    f.actionVisible.mockResolvedValue(false);
    expect(await npReadReleasedRunHistoryV1(f)).toBeNull();
  });
  it.each([null, id])("denies absent or mismatched principal proof %s", async (principal) => {
    mocks.principal.mockResolvedValue(principal);
    expect(
      await npReadReleasedRunHistoryV1(
        fixture([[{ id }], [{ ownerId: id, edgeCode: "action-run" }], [{ id }]]),
      ),
    ).toBeNull();
  });
  it.each([
    [[], [], []],
    [[{ id }], [{ ownerId: id, edgeCode: "action-run" }], []],
    [[{ id }], [], [{ id }]],
    [[{ id }], [{ ownerId: principalId, edgeCode: "action-run" }], [{ id }]],
    [[{ id }], [{ ownerId: id, edgeCode: "unknown" }], [{ id }]],
  ])("fails closed for missing or unmatched retained evidence", async (...rows) => {
    expect(await npReadReleasedRunHistoryV1(fixture(rows))).toBeNull();
  });
  it("redacts corrupt receipt failures", async () => {
    mocks.receipt.mockRejectedValue(new Error("private evidence"));
    expect(await npReadReleasedRunHistoryV1(fixture([[{ id }]]))).toBeNull();
  });
});
