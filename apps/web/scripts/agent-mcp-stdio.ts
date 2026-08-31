import "./_load-env.js";

import {
  formatAgentMcpStdioFailureV1,
  runAgentMcpStdioProcessV1,
} from "@nexpress/app/scripts/agent-mcp-stdio";

import { ensureFor, shutdownBootstrap } from "../src/lib/bootstrap.js";

try {
  await runAgentMcpStdioProcessV1({ ensureFor, shutdown: shutdownBootstrap });
} catch (error) {
  process.stderr.write(formatAgentMcpStdioFailureV1(error));
  process.exitCode = 1;
}
