import "./_load-env.js";

import { runWorker } from "@nexpress/app/scripts/worker";
import { ensureFor } from "../src/lib/init-core";

await runWorker({ ensureFor });
