---
"@nexpress/admin": patch
---

Page-builder multi-select (#467 #3): rows have a checkbox in the header and a sticky bulk-action toolbar appears when one or more blocks are selected. Click toggles a single id; shift-click extends across contiguous siblings; cmd/ctrl-click adds to the selection. Bulk actions cover Wrap-in-container (gated to contiguous siblings of one parent — `WRAP_MANY` reducer action), Duplicate (`DUPLICATE_MANY`), and Delete with confirmation (`DELETE_MANY`). The orchestrator's selection set is auto-pruned when a referenced id leaves the tree (post-delete / post-undo).
