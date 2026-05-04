import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@nexpress/blocks", () => ({
  registerBlock: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NX_DEFAULT_SITE_ID: "default",
  can: vi.fn(() => false),
  createDbConnection: vi.fn(() => ({ kind: "db" })),
  createStorageAdapter: vi.fn(() => ({ kind: "storage" })),
  getDb: vi.fn(() => ({ kind: "db" })),
  isSuperAdmin: vi.fn(() => false),
  listMembershipsForUser: vi.fn(() => Promise.resolve([])),
  listPluginStates: vi.fn(() => Promise.resolve([])),
  loadPlugins: vi.fn(() => Promise.resolve()),
  registerCollection: vi.fn(),
  registerThemes: vi.fn(),
  resolveSiteForHostname: vi.fn(),
  setCurrentSiteResolver: vi.fn(),
  setDb: vi.fn(),
  setI18nConfig: vi.fn(),
  setStorageAdapter: vi.fn(),
  startProducer: vi.fn(() => Promise.resolve()),
  syncPluginRegistrations: vi.fn(() => Promise.resolve()),
  verifyStartupSafety: vi.fn(),
  verifyTokenFull: vi.fn(),
}));

const core = await import("@nexpress/core");
const { createBootstrap } = await import("./bootstrap.js");

function buildConfig() {
  return {
    auth: { secret: "x".repeat(32) },
    collections: [],
    db: { connectionString: "postgres://nexpress:nexpress@localhost:5433/nexpress" },
    plugins: [{ id: "reading-time" }],
    site: { name: "Nexpress", url: "http://localhost:3000" },
  } as never;
}

describe("createBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(core.createDbConnection).mockReturnValue({ kind: "db" } as never);
    vi.mocked(core.getDb).mockReturnValue({ kind: "db" } as never);
    vi.mocked(core.listPluginStates).mockResolvedValue([]);
    vi.mocked(core.loadPlugins).mockResolvedValue(undefined);
    vi.mocked(core.startProducer).mockResolvedValue(undefined);
    vi.mocked(core.syncPluginRegistrations).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries plugin loading after a transient bootstrap failure", async () => {
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    const transient = new Error("connection timeout");
    vi.mocked(core.syncPluginRegistrations)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined);

    await expect(bootstrap.ensurePluginsLoaded()).rejects.toThrow("connection timeout");
    await expect(bootstrap.ensurePluginsLoaded()).resolves.toBeUndefined();

    expect(core.syncPluginRegistrations).toHaveBeenCalledTimes(2);
    expect(core.loadPlugins).toHaveBeenCalledTimes(1);
  });

  it("retries job producer startup after a transient failure", async () => {
    vi.stubEnv("NX_ENABLE_JOBS", "1");
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    const transient = new Error("producer timeout");
    vi.mocked(core.startProducer).mockRejectedValueOnce(transient).mockResolvedValueOnce(undefined);

    await expect(bootstrap.ensureJobProducer()).rejects.toThrow("producer timeout");
    await expect(bootstrap.ensureJobProducer()).resolves.toBeUndefined();
    expect(core.startProducer).toHaveBeenCalledTimes(2);
  });
});
