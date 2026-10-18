import "./_load-env.js";
import { runAgentGuardianProcessV1 } from "@nexpress/app/scripts/agent-guardian";
import { ensureFor, shutdownBootstrap } from "../src/lib/bootstrap.js";

process.exitCode = await runAgentGuardianProcessV1({ ensureFor, shutdown: shutdownBootstrap });
