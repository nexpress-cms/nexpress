import type { NpJobData } from "../jobs-contract/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
beforeEach(() => vi.resetModules());
async function fixture() {
  const [{ createAgentRuntimeJobsV1 }, handlers, context] = await Promise.all([
    import("./runtime-jobs.js"),
    import("../jobs/handlers.js"),
    import("../sites/context.js"),
  ]);
  const dispatch = vi.fn((_input: { siteId: string; eventId: string }) =>
    Promise.resolve({
      runIds: [] as string[],
      replayed: false,
      enqueued: 0,
      skipped: 0,
    }),
  );
  const process = vi.fn((_input: { siteId: string; runId: string }) =>
    Promise.resolve({ state: "queued" }),
  );
  const options = {
    coordinationSiteId: "site-a",
    events: {
      dispatch,
      schedule: () =>
        Promise.resolve({ runIds: [] as string[], nextCursor: null, enqueued: 0, failed: 0 }),
    },
    executor: { process },
  };
  return { createAgentRuntimeJobsV1, handlers, context, dispatch, process, options };
}
describe("explicit Runtime job registration", () => {
  it("does not register on import or construction and repeated registration is idempotent", async () => {
    const f = await fixture();
    expect(f.handlers.getJobHandler("agent:eventDispatch")).toBeUndefined();
    const jobs = f.createAgentRuntimeJobsV1(f.options);
    expect(f.handlers.getJobHandler("agent:runExecute")).toBeUndefined();
    jobs.register();
    const handler = f.handlers.getJobHandler("agent:eventDispatch");
    jobs.register();
    expect(f.handlers.getJobHandler("agent:eventDispatch")).toBe(handler);
    expect(f.handlers.getAllJobHandlers().size).toBe(6);
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.process).not.toHaveBeenCalled();
  });
  it("rejects registration conflicts before installing any sibling handler", async () => {
    const f = await fixture();
    f.handlers.registerJobHandler("agent:runExecute", () => Promise.resolve());
    expect(() => f.createAgentRuntimeJobsV1(f.options).register()).toThrow(
      "Agent runtime job is unavailable.",
    );
    expect(f.handlers.getJobHandler("agent:eventDispatch")).toBeUndefined();
    expect(f.handlers.getAllJobHandlers().size).toBe(1);
  });
  it("rejects invalid explicit coordination site with a stable error", async () => {
    const f = await fixture();
    expect(() =>
      f.createAgentRuntimeJobsV1({ ...f.options, coordinationSiteId: "_system" }),
    ).toThrow("Agent runtime job is unavailable.");
  });
  it("rejects extra authority, malformed identifiers and nonempty global tick payloads before host dispatch", async () => {
    const f = await fixture();
    f.createAgentRuntimeJobsV1(f.options).register();
    const dispatch = f.handlers.getJobHandler("agent:eventDispatch")!;
    const payloads: NpJobData[] = [
      { siteId: "site-a", eventId, authority: "staff" },
      { siteId: "site-a", eventId: "invalid" },
      { siteId: "INVALID", eventId },
    ];
    for (const payload of payloads) await expect(dispatch(payload)).rejects.toThrow();
    for (const type of [
      "agent:eventReconcile",
      "agent:scheduleTick",
      "agent:retentionTick",
    ] as const)
      await expect(f.handlers.getJobHandler(type)!({ siteId: "site-b" })).rejects.toThrow();
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("pins host calls to payload site despite an ambient different site", async () => {
    const f = await fixture();
    f.createAgentRuntimeJobsV1(f.options).register();
    const seen: Array<string | null> = [];
    f.dispatch.mockImplementation(async () => {
      seen.push(await f.context.getCurrentSiteId());
      return { runIds: [], replayed: false, enqueued: 0, skipped: 0 };
    });
    f.process.mockImplementation(async () => {
      seen.push(await f.context.getCurrentSiteId());
      return { state: "queued" };
    });
    await f.context.withCurrentSite("site-a", async () => {
      await f.handlers.getJobHandler("agent:eventDispatch")!({ siteId: "site-b", eventId });
      await f.handlers.getJobHandler("agent:runExecute")!({ siteId: "site-c", runId: eventId });
      expect(await f.context.getCurrentSiteId()).toBe("site-a");
    });
    expect(seen).toEqual(["site-b", "site-c"]);
    expect(f.dispatch).toHaveBeenCalledWith({ siteId: "site-b", eventId });
    expect(f.process).toHaveBeenCalledWith({ siteId: "site-c", runId: eventId });
  });
  it("does not persist host error details through generic job failure messages", async () => {
    const f = await fixture();
    f.createAgentRuntimeJobsV1(f.options).register();
    f.dispatch.mockRejectedValue(new Error("private-provider-body"));
    f.process.mockRejectedValue(new Error("credential-locator"));
    for (const [type, payload] of [
      ["agent:eventDispatch", { siteId: "site-a", eventId }],
      ["agent:runExecute", { siteId: "site-a", runId: eventId }],
    ] as const) {
      const error: unknown = await f.handlers.getJobHandler(type)!(payload).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Agent runtime job is unavailable.");
      expect((error as Error).cause).toBeUndefined();
      expect((error as Error).stack).toBe("Agent runtime job is unavailable.");
    }
  });
});
