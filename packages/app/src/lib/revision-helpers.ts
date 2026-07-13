import { createRevisionHelpers } from "@nexpress/next";

import { ensureFor } from "./init-core";
import { validateDocumentBlockContent } from "./block-content-validation";

export const {
  parseRevisionListOptions,
  listDocumentRevisions,
  getDocumentRevision,
  restoreDocumentRevision,
} = createRevisionHelpers({
  ensureReady: () => ensureFor("write"),
  validateSnapshot: validateDocumentBlockContent,
});
