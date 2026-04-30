import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import {
  configureBuiltinJobContext,
  getCollectionConfig,
  getDocumentById,
  startWorker,
} from "@nexpress/core";

import { ensureCoreServices, ensurePluginsLoaded } from "../src/lib/bootstrap";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env"), override: false });

async function main(): Promise<void> {
  // Read + narrow inside main() so the type carries through to
  // startWorker(databaseUrl) — TS won't propagate top-level narrowings
  // into nested function scopes.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

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

  // startWorker installs SIGINT / SIGTERM handlers itself
  // (Phase 20.4 — see #280) that flip the heartbeat row to
  // `stopped` and `process.exit(0)` synchronously, so the row
  // doesn't drift into `unhealthy` on graceful shutdown.
  await startWorker(databaseUrl);

  console.log("[nexpress] worker started — press Ctrl+C to stop");
}

main().catch((error) => {
  console.error("[nexpress] worker failed to start:", error);
  process.exit(1);
});
