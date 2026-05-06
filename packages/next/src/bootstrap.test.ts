import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@nexpress/blocks", () => ({
  registerBlock: vi.fn(),
  registerPattern: vi.fn(),
  resetSharedBlockRegistry: vi.fn(),
  resetSharedPatternRegistry: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  NP_DEFAULT_SITE_ID: "default",
  can: vi.fn(() => false),
  createDbConnection: vi.fn(() => ({ kind: "db" })),
  createStorageAdapter: vi.fn(() => ({ kind: "storage" })),
  getDb: vi.fn(() => ({ kind: "db" })),
  getOptionalJobQueue: vi.fn(() => null),
  isSuperAdmin: vi.fn(() => false),
  listMembershipsForUser: vi.fn(() => Promise.resolve([])),
  listPluginStates: vi.fn(() => Promise.resolve([])),
  loadPlugins: vi.fn(() => Promise.resolve()),
  registerCollection: vi.fn(),
  registerThemes: vi.fn(),
  resetPlugins: vi.fn(),
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
const blocks = await import("@nexpress/blocks");
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
    vi.stubEnv("NP_ENABLE_JOBS", "1");
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    const transient = new Error("producer timeout");
    vi.mocked(core.startProducer).mockRejectedValueOnce(transient).mockResolvedValueOnce(undefined);

    await expect(bootstrap.ensureJobProducer()).rejects.toThrow("producer timeout");
    await expect(bootstrap.ensureJobProducer()).resolves.toBeUndefined();
    expect(core.startProducer).toHaveBeenCalledTimes(2);
  });

  it("clears the shared block registry on plugin reload (#477)", async () => {
    // Issue #477 — `reloadPlugins()` must drop plugin-contributed
    // block definitions from the shared block registry, otherwise
    // disabled plugins keep surfacing in the admin's Add-block
    // popover and resolving server-side after a reload. The
    // bootstrap re-registers every enabled plugin's blocks
    // immediately after the reset, so the registry settles on
    // `built-ins + currently-enabled plugins`.
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    await bootstrap.ensurePluginsLoaded();
    vi.mocked(blocks.resetSharedBlockRegistry).mockClear();
    vi.mocked(blocks.resetSharedPatternRegistry).mockClear();
    vi.mocked(core.resetPlugins).mockClear();

    await bootstrap.reloadPlugins();

    expect(core.resetPlugins).toHaveBeenCalledTimes(1);
    expect(blocks.resetSharedBlockRegistry).toHaveBeenCalledTimes(1);
    // Pattern registry follows the same invariant — disabled
    // plugins must not leave their patterns behind.
    expect(blocks.resetSharedPatternRegistry).toHaveBeenCalledTimes(1);
  });
});
