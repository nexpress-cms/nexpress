import "./_load-env.js";

import nexpressConfig from "../src/nexpress.config.js";
import { generateSchema } from "@nexpress/app/scripts/generate-schema";

generateSchema({ config: nexpressConfig });
