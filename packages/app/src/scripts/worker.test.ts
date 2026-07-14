import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureBuiltinJobContext: vi.fn(),
  getCollectionConfig: vi.fn(),
  getDocumentById: vi.fn(),
  startWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@nexpress/core", () => mocks);

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

    await runWorker({ ensureFor });

    expect(ensureFor).toHaveBeenCalledOnce();
    expect(ensureFor).toHaveBeenCalledWith("worker");
    expect(mocks.startWorker).toHaveBeenCalledWith("postgres://localhost/nexpress");
  });
});
