---
"@nexpress/plugin-forum": patch
---

Add site-scoped forum board-directory and latest/notice feed blocks plus a
community-home pattern. The blocks close over configured forum paths and
collection slugs, reject unsafe board keys before querying, filter stale or
orphaned cross-board rows, and publish stable theme hooks with complete
fallback styles.
