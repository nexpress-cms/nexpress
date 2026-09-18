import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentActivityServiceV1 } from "./activity-service.js";
import type * as Admission from "./admin-admission.js";
const mocks = vi.hoisted(() => ({ history: vi.fn(), staff: vi.fn() }));
vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  }),
}));
vi.mock("./released-run-history.js", () => ({ npReadReleasedRunHistoryV1: mocks.history }));
vi.mock("./admin-admission.js", async (original) => ({
  ...(await original<typeof Admission>()),
  npResolveAgentStaffSessionAuthorizationV1: mocks.staff,
}));
const id = "11111111-1111-4111-8111-111111111111";
const input = {
  siteId: "history",
  id,
  actor: {
    user: {
      id,
      name: "Admin",
      email: "admin@example.test",
      role: "admin" as const,
      tokenVersion: 1,
    },
    sessionId: id,
  },
};
const authority = {
  authority: { kind: "super-admin", capabilities: ["admin.manage", "site.access"] },
};
const expired = { schemaVersion: "np.agent-activity-run-expired.v1", runId: id };
const service = () => createAgentActivityServiceV1({ cursorHmacKey: new Uint8Array(32).fill(7) });
beforeEach(() => {
  mocks.staff.mockReset().mockResolvedValue(authority);
  mocks.history.mockReset().mockResolvedValue(expired);
});
describe("Activity historical Run authority", () => {
  it("uses verified history only after no live Run exists and rechecks authority", async () => {
    expect(await service().getRun(input)).toEqual(expired);
    expect(mocks.history).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: input.siteId,
        runId: id,
        actionVisible: expect.any(Function),
      }),
    );
    expect(mocks.staff).toHaveBeenCalledTimes(2);
  });
  it("keeps missing or invalid historical evidence unavailable", async () => {
    mocks.history.mockResolvedValue(null);
    await expect(service().getRun(input)).rejects.toMatchObject({
      code: "ACTIVITY_NOT_FOUND",
      status: 404,
    });
  });
  it("denies loss of current staff authority before returning retained facts", async () => {
    mocks.staff
      .mockResolvedValueOnce(authority)
      .mockResolvedValue({ authority: { kind: "super-admin", capabilities: [] } });
    await expect(service().getRun(input)).rejects.toMatchObject({
      code: "ACTIVITY_FORBIDDEN",
      status: 403,
    });
  });
  it("does not look up receipts without current admin capability", async () => {
    mocks.staff.mockResolvedValue({ authority: { kind: "super-admin", capabilities: [] } });
    await expect(service().getRun(input)).rejects.toMatchObject({ code: "ACTIVITY_FORBIDDEN" });
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
