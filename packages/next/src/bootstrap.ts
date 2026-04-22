import {
  createDbConnection,
  createStorageAdapter,
  loadPlugins,
  registerCollection,
  setDb,
  setMediaDb,
  setStorageAdapter,
  startProducer,
  type NxConfig,
} from "@nexpress/core";

export type NxDb = ReturnType<typeof createDbConnection>;

export interface BootstrapOptions {
  /**
   * The project's nexpress.config — typically the default export of
   * `src/nexpress.config.ts`.
   */
  config: NxConfig;
  /**
   * The generated Drizzle schema module (e.g. `import * as schema from
   * "@/db/generated/collections"`). Tables are looked up by
   * `${camelCase(slug)}Table`, matching what `generate-schema.ts` emits.
   */
  generatedSchema: Record<string, unknown>;
  /**
   * Optional override for the database connection string. Falls back to
   * `config.db.connectionString` and then `DATABASE_URL`.
   */
  connectionString?: string;
}

export type Bootstrap = {
  readonly getDb: (this: void) => NxDb;
  readonly ensureCoreServices: (this: void) => void;
  readonly ensurePluginsLoaded: (this: void) => Promise<void>;
  readonly ensureJobProducer: (this: void) => Promise<void>;
};

function toCamelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}

function resolveTable(
  generatedSchema: Record<string, unknown>,
  slug: string,
): unknown {
  const identifier = `${toCamelCase(slug)}Table`;
  const table = generatedSchema[identifier];
  if (!table) {
    throw new Error(
      `Collection "${slug}" has no matching generated Drizzle table ` +
        `(expected export \`${identifier}\`). ` +
        `Did you run \`pnpm db:generate\` after adding the collection?`,
    );
  }
  return table;
}

/**
 * Builds a one-shot bootstrap for a Next.js nexpress project. The returned
 * `getDb()` is the single source of truth — it lazily creates the pg Pool,
 * wires the DB/storage singletons on `@nexpress/core`, and registers every
 * collection from the config using the generated schema for Drizzle tables.
 *
 * `ensurePluginsLoaded()` is idempotent and safe to race across requests.
 */
export function createBootstrap(options: BootstrapOptions): Bootstrap {
  const { config, generatedSchema } = options;

  let db: NxDb | null = null;
  let servicesInitialized = false;
  let collectionsRegistered = false;
  let pluginsLoaded = false;
  let pluginsLoadingPromise: Promise<void> | null = null;
  let producerStarted = false;
  let producerStartingPromise: Promise<void> | null = null;

  function getConnectionString(): string {
    const connectionString =
      options.connectionString || config.db.connectionString || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    return connectionString;
  }

  function ensureServices(instance: NxDb): void {
    if (servicesInitialized) return;

    setDb(instance);
    setMediaDb(instance);
    setStorageAdapter(
      createStorageAdapter(
        config.storage ?? {
          adapter: "local",
          local: { directory: "./uploads", baseUrl: "/uploads" },
        },
      ),
    );

    servicesInitialized = true;
  }

  function ensureCollections(): void {
    if (collectionsRegistered) return;

    for (const collection of config.collections) {
      registerCollection(
        collection.slug,
        resolveTable(generatedSchema, collection.slug),
        collection,
      );
    }

    collectionsRegistered = true;
  }

  function getDbInstance(): NxDb {
    if (!db) {
      db = createDbConnection({ connectionString: getConnectionString() });
    }
    ensureServices(db);
    ensureCollections();
    return db;
  }

  async function ensurePluginsLoaded(): Promise<void> {
    if (pluginsLoaded) return;
    if (pluginsLoadingPromise) return pluginsLoadingPromise;

    pluginsLoadingPromise = (async () => {
      getDbInstance();
      await loadPlugins(config.plugins ?? []);
      pluginsLoaded = true;
    })();

    return pluginsLoadingPromise;
  }

  const ensureCoreServices = (): void => {
    getDbInstance();
  };

  /**
   * Wires pg-boss as the job queue for this process so `enqueueJob` calls
   * actually send jobs. Opt-in via `NX_ENABLE_JOBS=1` — when it's off the
   * producer stays unwired and `enqueueJob` remains a no-op.
   *
   * Idempotent + race-safe.
   */
  async function ensureJobProducer(): Promise<void> {
    if (producerStarted) return;
    if (process.env.NX_ENABLE_JOBS !== "1") {
      producerStarted = true;
      return;
    }
    if (producerStartingPromise) return producerStartingPromise;

    producerStartingPromise = (async () => {
      await startProducer(getConnectionString());
      producerStarted = true;
    })();

    return producerStartingPromise;
  }

  return {
    getDb: getDbInstance,
    ensureCoreServices,
    ensurePluginsLoaded,
    ensureJobProducer,
  };
}
