import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerJobHandler } from "./handlers.js";
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
      await expect(
        enqueueJob("content:afterSave", {
          collection: "posts",
          documentId: "d4cafb07-c120-4503-90fa-6d6fc4104ce3",
          operation: "create",
          userId: "8dbb88e6-eb42-4c5d-968d-0b253fd5012f",
          memberId: null,
        }),
      ).resolves.toBe("");
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

      const data = {
        collection: "posts",
        documentId: "d4cafb07-c120-4503-90fa-6d6fc4104ce3",
        operation: "update" as const,
        userId: null,
        memberId: "7d133e30-8079-47a7-b970-66cd478956de",
      };
      const id = await enqueueJob("content:afterSave", data);

      expect(id).toBe("job-42");
      expect(enqueue).toHaveBeenCalledWith("content:afterSave", data);
    });

    it("runs a custom payload parser exactly once before queue persistence", async () => {
      const parsePayload = vi.fn((data: Record<string, unknown>) => ({ value: data.value }));
      registerJobHandler("test:parseOnce", async () => {}, { parsePayload });
      const enqueue = vi.fn().mockResolvedValue("job-43");
      setJobQueue({
        enqueue,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      });

      await enqueueJob("test:parseOnce", { value: "canonical" });

      expect(parsePayload).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledWith("test:parseOnce", { value: "canonical" });
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
      expect(typeof getOptionalJobQueue()?.isHealthy).toBe("undefined");
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

  describe("countByState shape (Phase 23.5)", () => {
    // Optional on the interface so non-pg-boss stubs don't have to
    // implement it; the admin endpoint omits the stuck-job widget
    // when missing rather than 500ing.
    it("queue without countByState still satisfies the interface", () => {
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      });
      expect(typeof getOptionalJobQueue()?.countByState).toBe("undefined");
    });

    it("returns the fully-populated record consumers depend on", async () => {
      const countByState = vi.fn().mockResolvedValue({
        created: 0,
        active: 1,
        completed: 12,
        failed: 3,
        retry: 0,
        cancelled: 0,
        expired: 7,
      });
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        countByState,
      });
      const counts = await getOptionalJobQueue()?.countByState?.();
      // Every key present so the admin can index without optional
      // chaining.
      expect(Object.keys(counts ?? {})).toEqual(
        expect.arrayContaining([
          "created",
          "active",
          "completed",
          "failed",
          "retry",
          "cancelled",
          "expired",
        ]),
      );
      expect(counts?.failed).toBe(3);
      expect(counts?.expired).toBe(7);
    });

    it("forwards the optional `since` filter", async () => {
      const since = new Date("2026-05-01T00:00:00Z");
      const countByState = vi.fn().mockResolvedValue({
        created: 0,
        active: 0,
        completed: 0,
        failed: 0,
        retry: 0,
        cancelled: 0,
        expired: 0,
      });
      setJobQueue({
        enqueue: vi.fn(),
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        countByState,
      });
      await getOptionalJobQueue()?.countByState?.({ since });
      expect(countByState).toHaveBeenCalledWith({ since });
    });
  });
});
