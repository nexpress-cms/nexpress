import type { NxCollectionConfig } from "@nexpress/core";

import { pagesCollection } from "./pages";
import { postsCollection } from "./posts";

export const collections: NxCollectionConfig[] = [postsCollection, pagesCollection];

export { pagesCollection, postsCollection };
