import {
  createDbConnection,
  createStorageAdapter,
  registerCollection,
  setDb as setCoreDb,
  setMediaDb,
  setStorageAdapter,
} from "@nexpress/core";

import { collections, config, getGeneratedTable } from "@/lib/nexpress-config";

export type NxDb = ReturnType<typeof createDbConnection>;

let db: NxDb | null = null;
let servicesInitialized = false;
let collectionsRegistered = false;

function getDatabaseUrl(): string {
  const connectionString = config.db.connectionString || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return connectionString;
}

function ensureServices(instance: NxDb): void {
  if (servicesInitialized) return;

  setCoreDb(instance);
  setMediaDb(instance);
  setStorageAdapter(createStorageAdapter(config.storage ?? { adapter: "local", local: { directory: "./uploads", baseUrl: "/uploads" } }));
  servicesInitialized = true;
}

function ensureCollections(): void {
  if (collectionsRegistered) return;

  for (const collection of collections) {
    registerCollection(collection.slug, getGeneratedTable(collection.slug), collection);
  }

  collectionsRegistered = true;
}

export function getDb(): NxDb {
  if (!db) {
    db = createDbConnection({ connectionString: getDatabaseUrl() });
  }

  ensureServices(db);
  ensureCollections();

  return db;
}
