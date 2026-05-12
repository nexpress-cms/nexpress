import { createRevisionHelpers } from "@nexpress/next";

import { ensureFor } from "@/lib/init-core";

export const {
  parseRevisionListOptions,
  listDocumentRevisions,
  getDocumentRevision,
  restoreDocumentRevision,
} = createRevisionHelpers({
  ensureReady: () => ensureFor("write"),
});
