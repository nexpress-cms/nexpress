import "./_load-env.js";

import nexpressConfig from "../src/nexpress.config.js";
import { generateSchema } from "@nexpress/app/scripts/generate-schema";
import { discussionsCollection } from "../src/collections/discussions.js";

// Keep the generic member-write DB fixture available to integration tests
// without registering it in the reference app's production collection API.
generateSchema({
  config: {
    ...nexpressConfig,
    collections: [...nexpressConfig.collections, discussionsCollection],
  },
});
