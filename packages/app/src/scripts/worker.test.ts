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
    const ensureFor = vi.fn().mockResolvedValue(undefined);

    const shutdown = vi.fn().mockResolvedValue(undefined);
    await runWorker({ ensureFor, shutdown });

    expect(ensureFor).toHaveBeenCalledOnce();
    expect(ensureFor).toHaveBeenCalledWith("worker");
    expect(mocks.startWorker).toHaveBeenCalledWith("postgres://localhost/nexpress", {
      onShutdown: shutdown,
    });
  });

  it("hydrates revalidation data without dispatching collection read hooks", async () => {
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
