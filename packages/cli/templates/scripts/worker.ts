import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import {
  configureBuiltinJobContext,
  getCollectionConfig,
  getDocumentById,
  startWorker,
} from "@nexpress/core";

import { ensureFor } from "@/lib/init-core";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

async function main() {
  // Read + narrow the env var inside main() so the type narrowing carries
  // through to startWorker(databaseUrl) below — TS won't propagate
  // top-level narrowings into nested function scopes.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  await ensureFor("read");
  await ensureFor("plugins");

  configureBuiltinJobContext({
    async resolveContentAfterSaveContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      const doc = await getDocumentById(collection, documentId);
      if (!doc) return null;
      // Phase 9.7o widened the hook payload to include
      // `principal`. The worker doesn't know the originating
      // actor with certainty — for a stub we treat the saved
      // userId as a staff principal. Sites with member-authored
      // writes should resolve the actor from the doc's
      // `member_author_id` instead.
      const user = { id: userId, email: "", name: "", role: "admin" as const, tokenVersion: 0 };
      return {
        collectionConfig: config,
        data: doc,
        user,
        principal: { kind: "staff", user },
      };
    },
    async resolveContentAfterDeleteContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      const user = { id: userId, email: "", name: "", role: "admin" as const, tokenVersion: 0 };
      return {
        collectionConfig: config,
        data: { id: documentId },
        user,
        principal: { kind: "staff", user },
      };
    },
  });

  // startWorker installs SIGINT / SIGTERM handlers itself that
  // call stopWorker() before process.exit(0) — the heartbeat
  // row flips to "stopped" cleanly instead of drifting to
  // "unhealthy" on graceful shutdown.
  await startWorker(databaseUrl);
  console.log("[nexpress] worker started — press Ctrl+C to stop");
}

main().catch((error) => {
  console.error("[nexpress] worker failed to start:", error);
  process.exit(1);
});
