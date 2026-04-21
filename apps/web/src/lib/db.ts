import {
  createDbConnection,
  createStorageAdapter,
  registerCollection,
  setDb as setCoreDb,
  setMediaDb,
  setStorageAdapter,
} from "@nexpress/core";

import { collections } from "@/collections";
import { pagesTable, postsTable } from "@/db/generated/collections";

export type NxDb = ReturnType<typeof createDbConnection>;

let db: NxDb | null = null;
let servicesInitialized = false;
let collectionsRegistered = false;

const collectionTables: Record<string, unknown> = {
  posts: postsTable,
  pages: pagesTable,
};

function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return connectionString;
}

function buildStorageConfig(): Parameters<typeof createStorageAdapter>[0] {
  if (process.env.NX_STORAGE_ADAPTER === "s3") {
    return {
      adapter: "s3",
      s3: {
        bucket: process.env.NX_S3_BUCKET ?? "",
        region: process.env.NX_S3_REGION ?? "us-east-1",
        endpoint: process.env.NX_S3_ENDPOINT,
      },
    };
  }

  return {
    adapter: "local",
    local: {
      directory: process.env.NX_STORAGE_DIR ?? "./uploads",
      baseUrl: process.env.NX_STORAGE_URL ?? "/uploads",
    },
  };
}

function ensureServices(instance: NxDb): void {
  if (servicesInitialized) return;

  setCoreDb(instance);
  setMediaDb(instance);
  setStorageAdapter(createStorageAdapter(buildStorageConfig()));
  servicesInitialized = true;
}

function ensureCollections(): void {
  if (collectionsRegistered) return;

  for (const config of collections) {
    const table = collectionTables[config.slug];

    if (!table) {
      throw new Error(
        `No Drizzle table registered for collection "${config.slug}". ` +
          `Run \`pnpm db:generate\` and add the table to collectionTables in lib/db.ts.`,
      );
    }

    registerCollection(config.slug, table, config);
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
