import { createCollectionHelpers } from "@nexpress/next";

import { ensureCoreServices, ensurePluginsLoaded } from "@/lib/bootstrap";

export const {
  parseFindOptions,
  findCollectionDocuments,
  getCollectionDocument,
  saveCollectionDocument,
  deleteCollectionDocument,
} = createCollectionHelpers({
  async ensureReady() {
    ensureCoreServices();
    await ensurePluginsLoaded();
  },
});
