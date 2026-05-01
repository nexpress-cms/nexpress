import { createCollectionHelpers } from "@nexpress/next";

import { ensureFor } from "@/lib/bootstrap";

export const {
  parseFindOptions,
  findCollectionDocuments,
  getCollectionDocument,
  saveCollectionDocument,
  deleteCollectionDocument,
} = createCollectionHelpers({
  ensureReady: () => ensureFor("write"),
});
