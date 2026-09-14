import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureBuiltinJobContext: vi.fn(),
  npGetPersistedCollectionDocumentById: vi.fn(),
  startWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@nexpress/core", () => ({
  configureBuiltinJobContext: mocks.configureBuiltinJobContext,
  startWorker: mocks.startWorker,
}));
vi.mock("@nexpress/core/collections", () => ({
  npGetPersistedCollectionDocumentById: mocks.npGetPersistedCollectionDocumentById,
}));

import { runWorker } from "./worker.js";

describe("worker bootstrap", () => {
  let jobsEnabled: string | undefined;
  let databaseUrl: string | undefined;

  beforeEach(() => {
    jobsEnabled = process.env.NP_ENABLE_JOBS;
    databaseUrl = process.env.DATABASE_URL;
    process.env.NP_ENABLE_JOBS = "1";
    process.env.DATABASE_URL = "postgres://localhost/nexpress";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (jobsEnabled === undefined) delete process.env.NP_ENABLE_JOBS;
    else process.env.NP_ENABLE_JOBS = jobsEnabled;
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses the worker intent so email is installed without a producer", async () => {
    await Promise.resolve();
    const ensureFor = vi.fn().mockResolvedValue(undefined);

    const shutdown = vi.fn().mockResolvedValue(undefined);
    await runWorker({ ensureFor, shutdown });

    expect(ensureFor).toHaveBeenCalledOnce();
    expect(ensureFor).toHaveBeenCalledWith("worker");
    expect(mocks.startWorker).toHaveBeenCalledWith("postgres://localhost/nexpress", {
      onShutdown: shutdown,
    });
  });

  it("installs the host before dispatch and closes resources after drain before bootstrap", async () => {
    await Promise.resolve();
    const order: string[] = [];
    const ensureFor = vi.fn(async () => {
      await Promise.resolve();
      order.push("bootstrap");
    });
    const shutdown = vi.fn(async () => {
      await Promise.resolve();
      order.push("shutdown");
    });
    const installRuntime = vi.fn(
      async ({ onShutdown }: { onShutdown: (cleanup: () => Promise<void>) => void }) => {
        await Promise.resolve();
        order.push("install");
        onShutdown(async () => {
          await Promise.resolve();
          order.push("first");
        });
        onShutdown(async () => {
          await Promise.resolve();
          order.push("second");
        });
      },
    );
    mocks.startWorker.mockImplementationOnce(async () => {
      await Promise.resolve();
      order.push("start");
    });
    await runWorker({ ensureFor, shutdown, installRuntime });
    expect(order).toEqual(["bootstrap", "install", "start"]);
    const options = mocks.startWorker.mock.calls[0]?.[1] as { onShutdown(): Promise<void> };
    order.push("drained");
    await Promise.all([options.onShutdown(), options.onShutdown()]);
    expect(order).toEqual([
      "bootstrap",
      "install",
      "start",
      "drained",
      "second",
      "first",
      "shutdown",
    ]);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("unwinds a partially failed installation and preserves the startup failure", async () => {
    await Promise.resolve();
    const failure = new Error("installation failed");
    const cleanup = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await expect(
      runWorker({
        ensureFor: vi.fn().mockResolvedValue(undefined),
        shutdown,
        installRuntime: async ({ onShutdown }) => {
          await Promise.resolve();
          onShutdown(cleanup);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it("closes the installed host when core worker startup rejects", async () => {
    await Promise.resolve();
    const failure = new Error("worker startup failed");
    const order: string[] = [];
    mocks.startWorker.mockImplementationOnce(async () => {
      await Promise.resolve();
      order.push("core unwound");
      throw failure;
    });
    await expect(
      runWorker({
        ensureFor: vi.fn().mockResolvedValue(undefined),
        shutdown: async () => {
          await Promise.resolve();
          order.push("bootstrap shutdown");
        },
        installRuntime: async ({ onShutdown }) => {
          await Promise.resolve();
          onShutdown(async () => {
            await Promise.resolve();
            order.push("runtime shutdown");
          });
        },
      }),
    ).rejects.toBe(failure);
    expect(order).toEqual(["core unwound", "runtime shutdown", "bootstrap shutdown"]);
  });

  it("does not install or start anything with jobs disabled", async () => {
    await Promise.resolve();
    process.env.NP_ENABLE_JOBS = "false";
    const ensureFor = vi.fn();
    const installRuntime = vi.fn();
    const shutdown = vi.fn();
    await expect(runWorker({ ensureFor, installRuntime, shutdown })).rejects.toThrow(
      "NP_ENABLE_JOBS",
    );
    expect(ensureFor).not.toHaveBeenCalled();
    expect(installRuntime).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it("rejects late cleanup registration and still shuts down bootstrap if host cleanup fails", async () => {
    await Promise.resolve();
    let register!: (cleanup: () => Promise<void>) => void;
    const failure = new Error("cleanup failed");
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await runWorker({
      ensureFor: vi.fn().mockResolvedValue(undefined),
      shutdown,
      installRuntime: async ({ onShutdown }) => {
        await Promise.resolve();
        register = onShutdown;
        onShutdown(async () => {
          await Promise.resolve();
          throw failure;
        });
      },
    });
    expect(() => register(() => Promise.resolve())).toThrow("during installation");
    const options = mocks.startWorker.mock.calls[0]?.[1] as { onShutdown(): Promise<void> };
    await expect(options.onShutdown()).rejects.toBe(failure);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("hydrates revalidation data without dispatching collection read hooks", async () => {
    await Promise.resolve();
    const document = { id: "doc-1", slug: "hello" };
    mocks.npGetPersistedCollectionDocumentById.mockResolvedValue(document);
    await runWorker({
      ensureFor: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });

    const context = mocks.configureBuiltinJobContext.mock.calls[0]?.[0] as {
      resolveContentAfterSaveContext(args: {
        siteId: string;
        collection: string;
        documentId: string;
      }): Promise<{ data: Record<string, unknown> } | null>;
    };
    await expect(
      context.resolveContentAfterSaveContext({
        siteId: "tenant-a",
        collection: "posts",
        documentId: "doc-1",
      }),
    ).resolves.toEqual({ data: document });
    expect(mocks.npGetPersistedCollectionDocumentById).toHaveBeenCalledWith(
      "posts",
      "doc-1",
      "tenant-a",
    );
  });
});
