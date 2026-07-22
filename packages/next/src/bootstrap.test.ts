import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

vi.mock("@nexpress/blocks", () => ({
  npAnalyzeBlockDefinitions: vi.fn(() => []),
  npAnalyzePatternDefinitions: vi.fn(() => []),
  getDefaultBlocks: vi.fn(() => [{ type: "rich-text" }]),
  registerBlock: vi.fn(),
  registerPattern: vi.fn(),
  resetSharedBlockRegistry: vi.fn(),
  resetSharedPatternRegistry: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({ npAssertProjectConfig: vi.fn() }));
vi.mock("@nexpress/core/auth", () => ({ verifyTokenFull: vi.fn() }));
vi.mock("@nexpress/core/bootstrap", () => ({
  createDbConnection: vi.fn(() => ({ kind: "db" })),
  configureStorageRuntime: vi.fn(() => ({ kind: "local" })),
  getDb: vi.fn(() => ({ kind: "db" })),
  getOptionalJobQueue: vi.fn(() => null),
  listPluginStates: vi.fn(() => Promise.resolve([])),
  loadPlugins: vi.fn(() => Promise.resolve()),
  npCloseDbConnection: vi.fn(() => Promise.resolve()),
  npShutdownStorageAdapter: vi.fn(() => Promise.resolve()),
  registerCollection: vi.fn(),
  registerThemes: vi.fn(),
  resetCacheInvalidationAdapter: vi.fn(),
  resetCollections: vi.fn(),
  resetCurrentSiteResolver: vi.fn(),
  resetDb: vi.fn(),
  resetI18nConfig: vi.fn(),
  resetPlugins: vi.fn(),
  resetSearchAdapter: vi.fn(),
  resetThemes: vi.fn(),
  setCurrentSiteResolver: vi.fn(),
  setCacheInvalidationAdapter: vi.fn(),
  setDb: vi.fn(),
  setI18nConfig: vi.fn(),
  setSearchAdapter: vi.fn((adapter) => adapter),
  shutdownSearchAdapter: vi.fn(() => Promise.resolve()),
  startProducer: vi.fn(() => Promise.resolve()),
  stopProducer: vi.fn(() => Promise.resolve()),
  syncPluginRegistrations: vi.fn(() => Promise.resolve()),
  teardownPlugins: vi.fn(() => Promise.resolve()),
}));
vi.mock("@nexpress/core/email", () => ({
  configureEmailRuntime: vi.fn(),
  npReadEmailRuntimeConfig: vi.fn(() => ({ adapter: "noop" })),
  resetEmailAdapter: vi.fn(),
}));
vi.mock("@nexpress/core/observability", () => ({
  configureObservabilityFromEnv: vi.fn(() => ({ logger: "console", errorReporter: "noop" })),
  shutdownObservability: vi.fn(() => Promise.resolve()),
  verifyStartupSafety: vi.fn(),
}));
vi.mock("@nexpress/core/rate-limit", () => ({
  npReadRateLimitRuntimeConfig: vi.fn(() => ({ adapter: "memory" })),
}));
vi.mock("@nexpress/core/sites", () => ({
  canOnSite: vi.fn(() => false),
  NP_DEFAULT_SITE_ID: "default",
  resolveSiteForHostname: vi.fn(),
}));
vi.mock("@nexpress/theme", () => ({ npAssertThemeDefinition: vi.fn() }));

const blocks = await import("@nexpress/blocks");
const core = await import("@nexpress/core");
const host = await import("@nexpress/core/bootstrap");
const email = await import("@nexpress/core/email");
const observability = await import("@nexpress/core/observability");
const cdn = await import("./cdn-purge.js");
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
    vi.mocked(host.createDbConnection).mockReturnValue({ kind: "db" } as never);
    vi.mocked(host.configureStorageRuntime).mockReturnValue({ kind: "local" } as never);
    vi.mocked(host.getDb).mockReturnValue({ kind: "db" } as never);
    vi.mocked(host.listPluginStates).mockResolvedValue([]);
    vi.mocked(host.loadPlugins).mockResolvedValue(undefined);
    vi.mocked(host.startProducer).mockResolvedValue(undefined);
    vi.mocked(host.syncPluginRegistrations).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cdn.resetCdnPurgeAdapter();
    vi.unstubAllEnvs();
  });

  it("installs the cache host and owns an injected CDN adapter", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const cdnPurgeAdapter = { kind: "cloudflare", purge: vi.fn(), shutdown };
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      cdnPurgeAdapter,
    });

    await bootstrap.ensureFor("read");
    expect(host.setCacheInvalidationAdapter).toHaveBeenCalledOnce();
    expect(cdn.getCdnPurgeAdapter()).toBe(cdnPurgeAdapter);

    await bootstrap.shutdown();
    expect(host.resetCacheInvalidationAdapter).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(cdn.getCdnPurgeAdapter()).toBeNull();
  });

  it("installs and closes an injected search adapter with read lifecycle ownership", async () => {
    const searchAdapter = {
      kind: "meilisearch",
      audience: "document-v1" as const,
      search: vi.fn(() => null),
      shutdown: vi.fn(() => Promise.resolve()),
    };
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      searchAdapter,
    });

    await bootstrap.ensureFor("read");
    expect(host.setSearchAdapter).toHaveBeenCalledWith(expect.objectContaining(searchAdapter));

    await bootstrap.shutdown();
    expect(host.shutdownSearchAdapter).toHaveBeenCalledWith(expect.objectContaining(searchAdapter));
  });

  it("detaches an injected search adapter during retryable read rollback", async () => {
    const searchAdapter = {
      kind: "meilisearch",
      audience: "document-v1" as const,
      search: vi.fn(() => null),
    };
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      searchAdapter,
    });
    vi.mocked(host.configureStorageRuntime).mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });

    await expect(bootstrap.ensureFor("read")).rejects.toThrow("storage unavailable");
    expect(host.resetSearchAdapter).toHaveBeenCalledWith(expect.objectContaining(searchAdapter));
  });

  it("detaches but preserves an owned CDN adapter across retryable read rollback", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const cdnPurgeAdapter = { kind: "cloudflare", purge: vi.fn(), shutdown };
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      cdnPurgeAdapter,
    });
    vi.mocked(host.configureStorageRuntime)
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      })
      .mockReturnValueOnce({ kind: "local" } as never);

    await expect(bootstrap.ensureFor("read")).rejects.toThrow("storage unavailable");
    expect(cdn.getCdnPurgeAdapter()).toBeNull();
    expect(shutdown).not.toHaveBeenCalled();

    await expect(bootstrap.ensureFor("read")).resolves.toBeUndefined();
    expect(cdn.getCdnPurgeAdapter()).toBe(cdnPurgeAdapter);
    await bootstrap.shutdown();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("closes an owned CDN adapter when shutdown happens before startup", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      cdnPurgeAdapter: { kind: "cloudflare", purge: vi.fn(), shutdown },
    });

    await bootstrap.shutdown();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(host.createDbConnection).not.toHaveBeenCalled();
  });

  it("validates construction inputs and requires the read intent before getDb", async () => {
    const config = buildConfig();
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    expect(core.npAssertProjectConfig).toHaveBeenCalledWith(config);
    expect(() => bootstrap.getDb()).toThrow('Await ensureFor("read")');
    await expect(bootstrap.ensureFor("unknown" as never)).rejects.toThrow(
      "Invalid bootstrap intent",
    );
    expect(() => createBootstrap({ config, generatedSchema: [] as never })).toThrow(
      "generatedSchema",
    );
    expect(() =>
      createBootstrap({
        config,
        generatedSchema: {},
        cdnPurgeAdapter: { kind: "BAD", purge: vi.fn() },
      }),
    ).toThrow("Invalid CDN purge adapter");
  });

  it("initializes a raced read exactly once and installs observability first", async () => {
    const logger = { kind: "pino" } as never;
    const errorReporter = { kind: "sentry" } as never;
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      logger,
      errorReporter,
    });

    await Promise.all([bootstrap.ensureFor("read"), bootstrap.ensureFor("read")]);

    expect(host.createDbConnection).toHaveBeenCalledOnce();
    expect(observability.configureObservabilityFromEnv).toHaveBeenCalledWith(process.env, {
      logger,
      errorReporter,
    });
    expect(
      vi.mocked(observability.configureObservabilityFromEnv).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(observability.verifyStartupSafety).mock.invocationCallOrder[0]);
  });

  it("installs an explicit custom storage adapter through the host boundary", async () => {
    const customAdapter = { kind: "cloudflare-r2" } as never;
    const config = Object.assign({}, buildConfig(), { storage: { adapter: "custom" as const } });
    vi.mocked(host.configureStorageRuntime).mockReturnValue(customAdapter);
    const bootstrap = createBootstrap({
      config,
      generatedSchema: {},
      storageAdapter: customAdapter,
    });

    await bootstrap.ensureFor("read");

    expect(host.configureStorageRuntime).toHaveBeenCalledWith({ adapter: "custom" }, customAdapter);
    expect(observability.verifyStartupSafety).toHaveBeenCalledWith(
      expect.objectContaining({ storageAdapter: "cloudflare-r2" }),
    );
  });

  it("rolls back a failed read and retries from a clean state", async () => {
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    vi.mocked(host.configureStorageRuntime)
      .mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      })
      .mockReturnValueOnce({ kind: "local" } as never);

    await expect(bootstrap.ensureFor("read")).rejects.toThrow("storage unavailable");
    await expect(bootstrap.ensureFor("read")).resolves.toBeUndefined();

    expect(host.createDbConnection).toHaveBeenCalledTimes(2);
    expect(host.resetDb).toHaveBeenCalledOnce();
    expect(host.resetCacheInvalidationAdapter).toHaveBeenCalledOnce();
    expect(host.npCloseDbConnection).toHaveBeenCalledOnce();
    expect(observability.shutdownObservability).toHaveBeenCalledOnce();
  });

  it("preflights every generated table before opening process resources", async () => {
    const config = Object.assign({}, buildConfig(), {
      collections: [
        { slug: "posts", fields: [] },
        { slug: "pages", fields: [] },
      ],
    });
    const bootstrap = createBootstrap({
      config,
      generatedSchema: { postsTable: { kind: "posts" } },
    });

    await expect(bootstrap.ensureFor("read")).rejects.toThrow("pagesTable");

    expect(host.createDbConnection).not.toHaveBeenCalled();
    expect(observability.configureObservabilityFromEnv).not.toHaveBeenCalled();
    expect(host.registerCollection).not.toHaveBeenCalled();
  });

  it("retries plugin loading after rolling back partial plugin state", async () => {
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    vi.mocked(host.syncPluginRegistrations)
      .mockRejectedValueOnce(new Error("connection timeout"))
      .mockResolvedValueOnce(undefined);

    await expect(bootstrap.ensureFor("plugins")).rejects.toThrow("connection timeout");
    await expect(bootstrap.ensureFor("plugins")).resolves.toBeUndefined();

    expect(host.syncPluginRegistrations).toHaveBeenCalledTimes(2);
    expect(host.resetPlugins).toHaveBeenCalledOnce();
    expect(host.loadPlugins).toHaveBeenCalledOnce();
  });

  it("loads every configured plugin so sites can apply different activation sets", async () => {
    const plugins = [{ id: "reading-time" }, { id: "forum" }];
    const config = Object.assign({}, buildConfig(), { plugins });
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await bootstrap.ensureFor("plugins");

    expect(host.loadPlugins).toHaveBeenCalledWith(plugins);
    expect(host.listPluginStates).not.toHaveBeenCalled();
  });

  it("separates worker email setup from the write producer and retries producer startup", async () => {
    vi.stubEnv("NP_ENABLE_JOBS", "1");
    const emailAdapter = { kind: "resend", send: vi.fn() } as never;
    const bootstrap = createBootstrap({
      config: buildConfig(),
      generatedSchema: {},
      emailAdapter,
    });
    vi.mocked(email.npReadEmailRuntimeConfig).mockReturnValueOnce({ adapter: "custom" });
    vi.mocked(host.startProducer)
      .mockRejectedValueOnce(new Error("producer timeout"))
      .mockResolvedValueOnce(undefined);

    await bootstrap.ensureFor("worker");
    expect(email.configureEmailRuntime).toHaveBeenCalledWith({ adapter: "custom" }, emailAdapter);
    expect(host.startProducer).not.toHaveBeenCalled();
    await expect(bootstrap.ensureFor("write")).rejects.toThrow("producer timeout");
    await expect(bootstrap.ensureFor("write")).resolves.toBeUndefined();
    expect(host.startProducer).toHaveBeenCalledTimes(2);
  });

  it("pins the successful read connection contract for later runtime intents", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://first/runtime");
    vi.stubEnv("NP_ENABLE_JOBS", "1");
    const config = Object.assign({}, buildConfig(), { db: {} });
    const bootstrap = createBootstrap({ config, generatedSchema: {} });

    await bootstrap.ensureFor("read");
    vi.stubEnv("DATABASE_URL", "postgres://second/runtime");
    await bootstrap.ensureFor("write");

    expect(host.createDbConnection).toHaveBeenCalledWith({
      connectionString: "postgres://first/runtime",
    });
    expect(host.startProducer).toHaveBeenCalledWith("postgres://first/runtime");
  });

  it("uses the exact shared jobs-enabled environment contract", async () => {
    vi.stubEnv("NP_ENABLE_JOBS", "yes");
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });

    await expect(bootstrap.ensureFor("write")).rejects.toThrow(/NP_ENABLE_JOBS/u);
    expect(host.startProducer).not.toHaveBeenCalled();
  });

  it("reloads plugins only after boot and clears contributed registries", async () => {
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });

    await bootstrap.reloadPlugins();

    expect(host.loadPlugins).toHaveBeenCalledTimes(2);
    expect(host.teardownPlugins).toHaveBeenCalledOnce();
    expect(host.resetPlugins).toHaveBeenCalledOnce();
    expect(blocks.resetSharedBlockRegistry).toHaveBeenCalledOnce();
    expect(blocks.resetSharedPatternRegistry).toHaveBeenCalledOnce();
  });

  it("serializes the full reload and lets shutdown drain schedule reconciliation", async () => {
    let finishReconcile: (() => void) | undefined;
    const reconcile = vi.fn(async () => {
      await new Promise<void>((resolve) => (finishReconcile = resolve));
      return { added: 1, updated: 0, removed: 0, workerOwnsRegistrations: false };
    });
    vi.mocked(host.getOptionalJobQueue).mockReturnValue({
      reconcilePluginSchedules: reconcile,
    } as never);
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });

    const firstReload = bootstrap.reloadPlugins();
    const secondReload = bootstrap.reloadPlugins();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    const closing = bootstrap.shutdown();

    expect(host.npCloseDbConnection).not.toHaveBeenCalled();
    finishReconcile?.();
    await expect(Promise.all([firstReload, secondReload])).resolves.toEqual([
      {
        reloaded: true,
        schedules: { added: 1, updated: 0, removed: 0, workerOwnsRegistrations: false },
      },
      {
        reloaded: true,
        schedules: { added: 1, updated: 0, removed: 0, workerOwnsRegistrations: false },
      },
    ]);
    await expect(closing).resolves.toBeUndefined();
    expect(host.loadPlugins).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(host.npCloseDbConnection).toHaveBeenCalledOnce();
  });

  it("rejects malformed contributions before loading and stamps valid pattern sources", async () => {
    const pattern = {
      id: "reading-time.summary",
      label: "Reading time summary",
      blocks: [{ id: "template", type: "rich-text", props: {} }],
    };
    const goodConfig = Object.assign({}, buildConfig(), {
      plugins: [{ id: "reading-time", patterns: [pattern] }],
    });
    await createBootstrap({ config: goodConfig, generatedSchema: {} }).ensureFor("plugins");
    expect(blocks.registerPattern).toHaveBeenCalledWith({
      ...pattern,
      source: "plugin:reading-time",
    });

    vi.clearAllMocks();
    vi.mocked(blocks.npAnalyzeBlockDefinitions).mockReturnValueOnce([
      { code: "invalid-definition", index: 0, message: "block.render must be a function." },
    ] as never);
    const badConfig = Object.assign({}, buildConfig(), {
      plugins: [{ id: "broken", blocks: [{ type: "broken" }] }],
    });
    await expect(
      createBootstrap({ config: badConfig, generatedSchema: {} }).ensureFor("plugins"),
    ).rejects.toThrow("[plugin:broken]");
    expect(host.loadPlugins).not.toHaveBeenCalled();
  });

  it("shuts resources down in dependency order, aggregates cleanup, and stays terminal", async () => {
    vi.stubEnv("NP_ENABLE_JOBS", "1");
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    await bootstrap.ensureFor("write");

    await Promise.all([bootstrap.shutdown(), bootstrap.shutdown()]);

    expect(host.stopProducer).toHaveBeenCalledOnce();
    expect(host.teardownPlugins).toHaveBeenCalledOnce();
    expect(host.npShutdownStorageAdapter).toHaveBeenCalledOnce();
    expect(host.npCloseDbConnection).toHaveBeenCalledOnce();
    expect(observability.shutdownObservability).toHaveBeenCalledOnce();
    const order = [
      vi.mocked(host.stopProducer).mock.invocationCallOrder[0],
      vi.mocked(host.teardownPlugins).mock.invocationCallOrder[0],
      vi.mocked(host.npShutdownStorageAdapter).mock.invocationCallOrder[0],
      vi.mocked(host.npCloseDbConnection).mock.invocationCallOrder[0],
      vi.mocked(observability.shutdownObservability).mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await expect(bootstrap.ensureFor("read")).rejects.toThrow("terminal shutdown");
    expect(() => bootstrap.getDb()).toThrow("terminal shutdown");
  });

  it("waits for in-flight initialization before terminal cleanup", async () => {
    let releasePluginSync: (() => void) | undefined;
    vi.mocked(host.syncPluginRegistrations).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releasePluginSync = resolve)),
    );
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    const starting = bootstrap.ensureFor("plugins");
    await vi.waitFor(() => expect(host.syncPluginRegistrations).toHaveBeenCalledOnce());

    const closing = bootstrap.shutdown();
    releasePluginSync?.();

    await expect(starting).rejects.toThrow("terminal shutdown");
    await expect(closing).resolves.toBeUndefined();
    expect(host.teardownPlugins).toHaveBeenCalledOnce();
    expect(host.npCloseDbConnection).toHaveBeenCalledOnce();
  });

  it("attempts every shutdown step when multiple adapters fail", async () => {
    vi.stubEnv("NP_ENABLE_JOBS", "1");
    const bootstrap = createBootstrap({ config: buildConfig(), generatedSchema: {} });
    await bootstrap.ensureFor("write");
    vi.mocked(host.stopProducer).mockRejectedValue(new Error("producer close"));
    vi.mocked(host.teardownPlugins).mockRejectedValue(new Error("plugin close"));
    vi.mocked(host.npShutdownStorageAdapter).mockRejectedValue(new Error("storage close"));
    vi.mocked(host.npCloseDbConnection).mockRejectedValue(new Error("db close"));
    vi.mocked(observability.shutdownObservability).mockRejectedValue(new Error("telemetry close"));

    const failure = await bootstrap.shutdown().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(5);
    expect(host.stopProducer).toHaveBeenCalledOnce();
    expect(host.teardownPlugins).toHaveBeenCalledOnce();
    expect(host.npShutdownStorageAdapter).toHaveBeenCalledOnce();
    expect(host.npCloseDbConnection).toHaveBeenCalledOnce();
    expect(observability.shutdownObservability).toHaveBeenCalledOnce();
  });
});
