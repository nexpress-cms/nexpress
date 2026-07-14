import "./_load-env.js";

import { runWorker } from "@nexpress/app/scripts/worker";
import { ensureFor } from "../src/lib/init-core.js";
import { shutdownBootstrap } from "../src/lib/bootstrap.js";

try {
  await runWorker({ ensureFor, shutdown: shutdownBootstrap });
} catch (error) {
  try {
    await shutdownBootstrap();
  } catch (shutdownError) {
    throw new AggregateError(
      [error, shutdownError],
      "Worker startup and bootstrap shutdown both failed.",
      { cause: shutdownError },
    );
  }
  throw error;
}
