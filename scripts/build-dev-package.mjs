import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve the package's own builder; tsx owns watching and starts a fresh process
// for source, config and dependency changes, so tsup keeps no stale manifest cache.
const require = createRequire(resolve(process.cwd(), "package.json"));
const { build } = await import(pathToFileURL(require.resolve("tsup")).href);

// Development builds retain declarations from the last full build in fast mode.
await build({ clean: false });
