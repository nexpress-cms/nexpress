import type { NpAgentRuntimeControlContextV1 } from "./runtime-controls.js";
import type { NpJobData } from "../jobs-contract/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
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
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    vi.resetModules();
    // Fresh imports are fixture setup; the test deadline measures handler behavior.
    f = await fixture();
  });
  it("does not register on import or construction and repeated registration is idempotent", () => {
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
  it("rejects registration conflicts before installing any sibling handler", () => {
    f.handlers.registerJobHandler("agent:runExecute", () => Promise.resolve());
    expect(() => f.createAgentRuntimeJobsV1(f.options).register()).toThrow(
      "Agent runtime job is unavailable.",
    );
    expect(f.handlers.getJobHandler("agent:eventDispatch")).toBeUndefined();
    expect(f.handlers.getAllJobHandlers().size).toBe(1);
  });
  it("registers delivery only for an explicit host owner and carries the persisted site and attempt", async () => {
    const send = vi.fn(() => Promise.resolve());
    expect(f.handlers.getJobHandler("agent:notificationSend")).toBeUndefined();
    f.createAgentRuntimeJobsV1({
      ...f.options,
      notificationDelivery: { process: send, reconcile: () => Promise.resolve() },
    }).register();
    expect(send).not.toHaveBeenCalled();
    await f.context.withCurrentSite("site-a", async () => {
      await f.handlers.getJobHandler("agent:notificationSend")!({
        siteId: "site-b",
        notificationId: eventId,
        expectedAttempt: 2,
      });
    });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      siteId: "site-b",
      notificationId: eventId,
      expectedAttempt: 2,
    });
    const invalidPayloads: NpJobData[] = [
      { siteId: "site-b", notificationId: eventId, expectedAttempt: 6 },
      { siteId: "site-b", notificationId: eventId, expectedAttempt: 1.5 },
      { siteId: "site-b", notificationId: eventId, expectedAttempt: 0, authority: "staff" },
    ];
    for (const payload of invalidPayloads)
      await expect(f.handlers.getJobHandler("agent:notificationSend")!(payload)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("reconciles only installed Guardian owners for each persisted fanout site while Runtime is disabled", async () => {
    vi.resetModules();
    const schema = await import("../db/schema/system.js");
    const { npCreateDisabledAgentRuntimeSettingsV1 } =
      await import("../agent-contract/runtime-contract.js");
    const settings = npCreateDisabledAgentRuntimeSettingsV1();
    const siteRows = [{ id: "site-b" }, { id: "site-c" }];
    interface Query {
      where(): Query;
      orderBy(): Query;
      limit(): Promise<Array<{ id: string }>>;
    }
    const db = {
      select: () => ({
        from: (table: unknown) => {
          const query: Query = {
            where: () => query,
            orderBy: () => query,
            limit: () => Promise.resolve(table === schema.npSites ? siteRows : []),
          };
          return query;
        },
      }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
    };
    // Replace only the transaction/source seam. The registered job still owns actual fanout/context behavior.
    vi.doMock("./runtime-controls.js", () => ({
      npWithAgentRuntimeControlTransactionV1: <T>(
        siteId: string,
        operation: (context: NpAgentRuntimeControlContextV1) => Promise<T>,
      ) =>
        operation({
          db: db as unknown as NpAgentRuntimeControlContextV1["db"],
          siteId,
          settings,
          revision: 1,
          control: { revision: 1, currentResumePlan: null, lastResumeReceipt: null },
        }),
    }));
    try {
      const local = await fixture();
      const seen: Array<string | null> = [];
      const reconcile = vi.fn(async (_input: { siteId: string; limit?: number }) => {
        seen.push(await local.context.getCurrentSiteId());
        return { checked: 0, resolved: 0 };
      });
      const contentSites: Array<string | null> = [];
      const collect = vi.fn(async (_input: { siteId: string; limit?: number }) => {
        contentSites.push(await local.context.getCurrentSiteId());
        return {
          state: "collecting" as const,
          processed: 0,
          emitted: 0,
          blocked: 0,
          sampled: 0,
          backlog: 0,
          held: 0,
        };
      });
      const runtimeSites: Array<string | null> = [];
      const runtimeCollect = vi.fn(async (_input: { siteId: string; limit?: number }) => {
        runtimeSites.push(await local.context.getCurrentSiteId());
        return {
          state: "collecting" as const,
          processed: 0,
          emitted: 0,
          blocked: 0,
          sampled: 0,
          held: 0,
          backlog: 0,
        };
      });
      const installed = local.createAgentRuntimeJobsV1({
        ...local.options,
        guardianRestrictions: { reconcile },
        guardianContent: { collect },
        guardianRuntime: { collect: runtimeCollect },
      });
      expect(reconcile).not.toHaveBeenCalled();
      expect(collect).not.toHaveBeenCalled();
      await local.context.withCurrentSite("site-a", async () => {
        await installed.reconcile();
        expect(await local.context.getCurrentSiteId()).toBe("site-a");
      });
      expect(settings.enabled).toBe(false);
      expect(reconcile.mock.calls.map(([input]) => input)).toEqual([
        { siteId: "site-b", limit: 25 },
        { siteId: "site-c", limit: 25 },
      ]);
      expect(seen).toEqual(["site-b", "site-c"]);
      expect(collect.mock.calls.map(([input]) => input)).toEqual([
        { siteId: "site-b", limit: 25 },
        { siteId: "site-c", limit: 25 },
      ]);
      expect(contentSites).toEqual(["site-b", "site-c"]);
      expect(runtimeSites).toEqual(["site-b", "site-c"]);
      expect(runtimeCollect.mock.calls.map(([input]) => input)).toEqual([
        { siteId: "site-b", limit: 25 },
        { siteId: "site-c", limit: 25 },
      ]);
      await local.createAgentRuntimeJobsV1(local.options).reconcile();
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(collect).toHaveBeenCalledTimes(2);
      expect(runtimeCollect).toHaveBeenCalledTimes(2);
      expect(local.dispatch).not.toHaveBeenCalled();
      expect(local.process).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("./runtime-controls.js");
      vi.resetModules();
    }
  });
  it("rejects invalid explicit coordination site with a stable error", () => {
    expect(() =>
      f.createAgentRuntimeJobsV1({ ...f.options, coordinationSiteId: "_system" }),
    ).toThrow("Agent runtime job is unavailable.");
  });
  it("rejects extra authority, malformed identifiers and nonempty global tick payloads before host dispatch", async () => {
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
