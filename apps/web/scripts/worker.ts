import "./_load-env.js";

import { runWorker } from "@nexpress/app/scripts/worker";
import { shutdownObservability } from "@nexpress/core/observability";
import { ensureFor } from "../src/lib/init-core.js";

try {
  await runWorker({ ensureFor });
} catch (error) {
  try {
    await shutdownObservability();
  } catch (shutdownError) {
    throw new AggregateError(
      [error, shutdownError],
      "Worker startup and observability shutdown both failed.",
      { cause: shutdownError },
    );
  }
  throw error;
}
