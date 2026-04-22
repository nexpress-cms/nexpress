import { createCollectionHelpers } from "@nexpress/next";

import { ensureWriteReady } from "@/lib/init-core";

export const {
  parseFindOptions,
  findCollectionDocuments,
  getCollectionDocument,
  saveCollectionDocument,
  deleteCollectionDocument,
} = createCollectionHelpers({
  ensureReady: ensureWriteReady,
});
