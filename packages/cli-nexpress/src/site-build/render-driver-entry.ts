import { runSiteBuildRenderDriverV1 } from "./render-driver.js";

try {
  await runSiteBuildRenderDriverV1();
} catch {
  // Fixed diagnostics are written by the driver. Never print nested project
  // exceptions, request data or private synthetic session material to stderr.
  process.exitCode = 1;
}
