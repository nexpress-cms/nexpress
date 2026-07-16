import { configureBuiltinJobContext, startWorker } from "@nexpress/core";
import { npGetPersistedCollectionDocumentById } from "@nexpress/core/collections";
import { npRequireJobsEnabledFlag } from "@nexpress/core/jobs-contract";

/**
 * Worker entry — site code passes its own `ensureFor` so the
 * bootstrap singletons (DB, plugins, email, jobs) match the running app.
 *
 * The consumer wrapper:
 *
 *   import "@nexpress/app/scripts/_load-env";
 *   import { runWorker } from "@nexpress/app/scripts/worker";
 *   import { ensureFor } from "../src/lib/init-core";
 *   import { shutdownBootstrap } from "../src/lib/bootstrap";
 *
 *   await runWorker({ ensureFor, shutdown: shutdownBootstrap });
 *
 * Resolves the DATABASE_URL from env (loaded by `_load-env`),
 * primes the built-in job context so post-write cache revalidation can
 * resolve the latest exact document, then hands control to `startWorker` which installs
 * SIGINT/SIGTERM and runs until killed.
 */
export interface RunWorkerOptions {
  ensureFor: (intent: "worker") => Promise<void>;
  shutdown: () => Promise<void>;
}

export async function runWorker({ ensureFor, shutdown }: RunWorkerOptions): Promise<void> {
  if (!npRequireJobsEnabledFlag(process.env.NP_ENABLE_JOBS)) {
    throw new Error("NP_ENABLE_JOBS must be 1 or true when starting the worker");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  // Loads plugins and installs the exact email adapter without starting a
  // competing enqueue-only pg-boss producer in this worker process.
  await ensureFor("worker");

  configureBuiltinJobContext({
    async revalidateCollection(collection, document) {
      const { revalidateCollection } = await import("../lib/revalidate.js");
      await revalidateCollection(collection, document);
    },
    async revalidatePublishedDocuments(byCollection) {
      const { revalidatePublishedDocuments } =
        await import("../lib/scheduled-publish-revalidate.js");
      await revalidatePublishedDocuments(byCollection);
    },
    async resolveContentAfterSaveContext({ siteId, collection, documentId }) {
      const doc = await npGetPersistedCollectionDocumentById(collection, documentId, siteId);
      if (!doc) return null;
      return { data: doc };
    },
    resolveContentAfterDeleteContext({ documentId }) {
      return Promise.resolve({ data: { id: documentId } });
    },
  });

  // startWorker installs SIGINT / SIGTERM handlers itself
  // (Phase 20.4 — see #280) that flip the heartbeat row to
  // `stopped` and `process.exit(0)` synchronously, so the row
  // doesn't drift into `unhealthy` on graceful shutdown.
  await startWorker(databaseUrl, { onShutdown: shutdown });

  console.log("[nexpress] worker started — press Ctrl+C to stop");
}
