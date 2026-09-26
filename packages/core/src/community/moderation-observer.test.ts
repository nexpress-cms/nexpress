import { afterEach, describe, expect, it, vi } from "vitest";
import type { NpCommentRow } from "../community-contract/types.js";
import {
  npWriteObservedCommentV1,
  resetCommunityModerationObserverV1,
  setCommunityModerationObserverV1,
} from "./moderation-observer.js";
const mocks = vi.hoisted(() => ({ db: {}, transaction: vi.fn(), stored: false }));
vi.mock("../db/runtime.js", () => ({
  getDb: () => ({ ...mocks.db, transaction: mocks.transaction }),
}));
const id = "00000000-0000-4000-8000-000000000001";
const row = (): NpCommentRow => ({
  id,
  targetType: "posts",
  targetId: id,
  parentId: null,
  memberId: id,
  bodyMd: "comment",
  bodyHtml: "<p>comment</p>",
  status: "pending",
  hiddenByUserId: null,
  hiddenByMemberId: null,
  hiddenReason: null,
  editedAt: null,
  siteId: "default",
  createdAt: new Date("2026-09-27T00:00:00.000Z"),
});
afterEach(() => {
  resetCommunityModerationObserverV1();
  vi.clearAllMocks();
  mocks.stored = false;
});
const input = () => ({
  siteId: "default",
  operation: "create" as const,
  actorMemberId: id,
  spamVerdict: "flag" as const,
  profanityVerdict: "pass" as const,
  write: vi.fn(() => {
    mocks.stored = true;
    return Promise.resolve(row());
  }),
});
describe("explicit community moderation observer", () => {
  it("keeps absence disabled and executes the existing write without a new transaction", async () => {
    const request = input();
    expect(await npWriteObservedCommentV1(request)).toEqual(row());
    expect(request.write).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("prepares before mutation and lets durable recorder failure roll back the source transaction", async () => {
    const order: string[] = [];
    mocks.transaction.mockImplementation(async (run: (db: object) => Promise<unknown>) => {
      try {
        return await run(mocks.db);
      } catch (error) {
        mocks.stored = false;
        throw error;
      }
    });
    const record = vi.fn(() => {
      order.push("record");
      return Promise.reject(new Error("durable event failed"));
    });
    setCommunityModerationObserverV1({
      prepare: () => {
        order.push("prepare");
        return Promise.resolve();
      },
      record,
    });
    const request = {
      ...input(),
      write: () => {
        order.push("write");
        mocks.stored = true;
        return Promise.resolve(row());
      },
    };
    await expect(npWriteObservedCommentV1(request)).rejects.toThrow("durable event failed");
    expect(order).toEqual(["prepare", "write", "record"]);
    expect(mocks.stored).toBe(false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        spamVerdict: "flag",
        profanityVerdict: "pass",
        operation: "create",
      }),
    );
  });
});
