import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import {
  configureBuiltinJobContext,
  getCollectionConfig,
  getDocumentById,
  startWorker,
  stopWorker,
} from "@nexpress/core";

import { ensureCoreServices, ensurePluginsLoaded } from "../src/lib/bootstrap";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

async function main(): Promise<void> {
  ensureCoreServices();
  await ensurePluginsLoaded();

  configureBuiltinJobContext({
    async resolveContentAfterSaveContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      const doc = await getDocumentById(collection, documentId);
      if (!doc) return null;
      return {
        collectionConfig: config,
        data: doc,
        user: {
          id: userId,
          email: "",
          name: "",
          role: "admin",
          tokenVersion: 0,
        },
      };
    },
    async resolveContentAfterDeleteContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      return {
        collectionConfig: config,
        data: { id: documentId },
        user: {
          id: userId,
          email: "",
          name: "",
          role: "admin",
          tokenVersion: 0,
        },
      };
    },
  });

  await startWorker(databaseUrl);

  console.log("[nexpress] worker started — press Ctrl+C to stop");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[nexpress] received ${signal}, stopping…`);
    await stopWorker();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[nexpress] worker failed to start:", error);
  process.exit(1);
});
