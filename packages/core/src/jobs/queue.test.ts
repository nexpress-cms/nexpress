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
});
