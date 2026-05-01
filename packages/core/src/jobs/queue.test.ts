import { beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueJob, getJobQueue, getOptionalJobQueue, setJobQueue } from "./queue.js";

describe("job queue", () => {
  beforeEach(() => {
    setJobQueue(null);
  });

  describe("when no queue is wired", () => {
    it("getOptionalJobQueue returns null", () => {
      expect(getOptionalJobQueue()).toBeNull();
    });

    it("getJobQueue throws with a helpful message", () => {
      expect(() => getJobQueue()).toThrow(/Job queue not initialized/);
    });

    it("enqueueJob no-ops and returns an empty id", async () => {
      await expect(enqueueJob("content:afterSave", { foo: 1 })).resolves.toBe("");
    });
  });

  describe("when a queue is wired", () => {
    it("enqueueJob delegates to the queue's enqueue", async () => {
      const enqueue = vi.fn().mockResolvedValue("job-42");
      setJobQueue({
        enqueue,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      });

      const id = await enqueueJob("content:afterSave", { foo: 1 });

      expect(id).toBe("job-42");
      expect(enqueue).toHaveBeenCalledWith("content:afterSave", { foo: 1 });
    });
  });

  describe("isHealthy probe shape (Phase 22.4)", () => {
    // The interface is optional, so adapters that don't implement
    // it should not break the readiness probe contract — these
    // tests pin the shape consumers (`/api/health/ready`) rely on.

    it("queue object without isHealthy still satisfies the interface", () => {
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      });
      expect(getOptionalJobQueue()?.isHealthy).toBeUndefined();
    });

    it("isHealthy returns true on a configured-and-alive adapter stub", async () => {
      const isHealthy = vi.fn().mockResolvedValue(true);
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        isHealthy,
      });
      const result = await getOptionalJobQueue()?.isHealthy?.();
      expect(result).toBe(true);
      expect(isHealthy).toHaveBeenCalledOnce();
    });

    it("isHealthy returns false when the underlying check rejects", async () => {
      // Adapters MUST swallow exceptions and return false — the
      // readiness probe expects a boolean, not a thrown error.
      // The pg-boss adapter does this via its own try/catch; this
      // test pins the contract callers depend on.
      const isHealthy = vi.fn().mockResolvedValue(false);
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        isHealthy,
      });
      const result = await getOptionalJobQueue()?.isHealthy?.();
      expect(result).toBe(false);
    });
  });
});
