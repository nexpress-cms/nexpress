import {
  configureBuiltinJobContext,
  getCollectionConfig,
  getDocumentById,
  startWorker,
} from "@nexpress/core";

/**
 * Worker entry — site code passes its own `ensureFor` so the
 * bootstrap singletons (DB, plugins, jobs) match the running app.
 *
 * The consumer wrapper:
 *
 *   import "@nexpress/app/scripts/_load-env";
 *   import { runWorker } from "@nexpress/app/scripts/worker";
 *   import { ensureFor } from "../src/lib/init-core";
 *
 *   await runWorker({ ensureFor });
 *
 * Resolves the DATABASE_URL from env (loaded by `_load-env`),
 * primes the built-in job context (so the worker can rehydrate
 * `content:afterSave` / `:afterDelete` hooks for staff-authored
 * writes), then hands control to `startWorker` which installs
 * SIGINT/SIGTERM and runs until killed.
 */
export interface RunWorkerOptions {
  ensureFor: (intent: "read" | "plugins" | "write") => Promise<void>;
}

export async function runWorker({ ensureFor }: RunWorkerOptions): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  await ensureFor("plugins");

  configureBuiltinJobContext({
    async resolveContentAfterSaveContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      const doc = await getDocumentById(collection, documentId);
      if (!doc) return null;
      // The worker doesn't know the originating actor with
      // certainty — for a stub we treat the saved userId as a
      // staff principal. Sites with member-authored writes
      // should resolve the actor from the doc's `member_author_id`
      // instead.
      const user = {
        id: userId,
        email: "",
        name: "",
        role: "admin" as const,
        tokenVersion: 0,
      };
      return {
        collectionConfig: config,
        data: doc,
        user,
        principal: { kind: "staff", user },
      };
    },
    resolveContentAfterDeleteContext({ collection, documentId, userId }) {
      const config = getCollectionConfig(collection);
      const user = {
        id: userId,
        email: "",
        name: "",
        role: "admin" as const,
        tokenVersion: 0,
      };
      return Promise.resolve({
        collectionConfig: config,
        data: { id: documentId },
        user,
        principal: { kind: "staff", user },
      });
    },
  });

  // startWorker installs SIGINT / SIGTERM handlers itself
  // (Phase 20.4 — see #280) that flip the heartbeat row to
  // `stopped` and `process.exit(0)` synchronously, so the row
  // doesn't drift into `unhealthy` on graceful shutdown.
  await startWorker(databaseUrl);

  console.log("[nexpress] worker started — press Ctrl+C to stop");
}
