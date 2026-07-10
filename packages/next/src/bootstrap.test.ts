import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@nexpress/blocks", () => ({
  npAnalyzeBlockDefinitions: vi.fn(() => []),
  npAnalyzePatternDefinitions: vi.fn(() => []),
  getDefaultBlocks: vi.fn(() => [{ type: "rich-text" }]),
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
  getOptionalRateLimiter: vi.fn(() => null),
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

  it("rejects invalid plugin blocks before mutating the core plugin registry", async () => {
    const config = Object.assign({}, buildConfig(), {
      plugins: [
        {
          id: "broken-block",
          blocks: [{ type: "broken" }],
        },
      ],
    });
    vi.mocked(blocks.npAnalyzeBlockDefinitions).mockReturnValueOnce([
      {
        code: "invalid-definition",
        index: 0,
        message: "invalid block at index 0: block.render must be a function.",
      },
    ]);
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await expect(bootstrap.ensurePluginsLoaded()).rejects.toThrow(
      "[plugin:broken-block] invalid block at index 0",
    );
    expect(core.loadPlugins).not.toHaveBeenCalled();
    expect(blocks.registerBlock).not.toHaveBeenCalled();
  });

  it("rejects invalid plugin patterns before mutating the core plugin registry", async () => {
    const config = Object.assign({}, buildConfig(), {
      plugins: [{ id: "broken-pattern", patterns: [{ id: "broken" }] }],
    });
    vi.mocked(blocks.npAnalyzePatternDefinitions).mockReturnValueOnce([
      {
        code: "invalid-definition",
        index: 0,
        message: "invalid pattern at index 0: pattern.label must be a non-empty string.",
      },
    ]);
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await expect(bootstrap.ensurePluginsLoaded()).rejects.toThrow(
      "[plugin:broken-pattern] invalid pattern at index 0",
    );
    expect(core.loadPlugins).not.toHaveBeenCalled();
    expect(blocks.registerPattern).not.toHaveBeenCalled();
  });

  it("registers validated plugin patterns with a concrete source", async () => {
    const pattern = {
      id: "reading-time.summary",
      label: "Reading time summary",
      blocks: [{ id: "template", type: "rich-text", props: {} }],
    };
    const config = Object.assign({}, buildConfig(), {
      plugins: [{ id: "reading-time", patterns: [pattern] }],
    });
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await bootstrap.ensurePluginsLoaded();

    expect(blocks.registerPattern).toHaveBeenCalledWith({
      ...pattern,
      source: "plugin:reading-time",
    });
  });

  it("rejects plugin patterns that reference unavailable block types", async () => {
    const config = Object.assign({}, buildConfig(), {
      plugins: [
        {
          id: "broken-reference",
          patterns: [
            {
              id: "broken-reference.hero",
              label: "Broken hero",
              blocks: [{ id: "template", type: "missing.hero", props: {} }],
            },
          ],
        },
      ],
    });
    vi.mocked(blocks.npAnalyzePatternDefinitions)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          code: "unknown-block-type",
          index: 0,
          id: "broken-reference.hero",
          blockType: "missing.hero",
          message: 'pattern "broken-reference.hero" references unknown block type "missing.hero".',
        },
      ]);
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await expect(bootstrap.ensurePluginsLoaded()).rejects.toThrow(
      '[plugin:broken-reference] pattern "broken-reference.hero" references unknown block type',
    );
    expect(core.loadPlugins).not.toHaveBeenCalled();
  });

  it("rejects invalid theme patterns instead of silently dropping them", async () => {
    const config = Object.assign({}, buildConfig(), {
      themes: [
        {
          manifest: { id: "broken-theme" },
          impl: { patterns: [{ id: "broken" }] },
        },
      ],
    });
    vi.mocked(blocks.npAnalyzePatternDefinitions).mockReturnValueOnce([
      {
        code: "invalid-definition",
        index: 0,
        message: "invalid pattern at index 0: pattern.label must be a non-empty string.",
      },
    ]);
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await expect(bootstrap.ensurePluginsLoaded()).rejects.toThrow(
      "[theme:broken-theme] invalid pattern at index 0",
    );
    expect(core.loadPlugins).not.toHaveBeenCalled();
  });
});
