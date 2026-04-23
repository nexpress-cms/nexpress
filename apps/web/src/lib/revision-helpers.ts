import { createRevisionHelpers } from "@nexpress/next";

import { ensureWriteReady } from "@/lib/init-core";

export const {
  parseRevisionListOptions,
  listDocumentRevisions,
  getDocumentRevision,
  restoreDocumentRevision,
} = createRevisionHelpers({
  ensureReady: ensureWriteReady,
});
