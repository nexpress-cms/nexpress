import "./_load-env.js";
import { runAgentRuntimeProcessV1 } from "@nexpress/app/scripts/agent-runtime";
import { ensureFor, shutdownBootstrap } from "../src/lib/bootstrap.js";

process.exitCode = await runAgentRuntimeProcessV1({ ensureFor, shutdown: shutdownBootstrap });
