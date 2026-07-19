---
"@nexpress/plugin-forum": patch
---

Add bounded board-scoped title/body search, category and member filters,
filter-preserving pagination, and discovery controls to the forum list skin
contract. Malformed filters and out-of-range pages now fail closed, while
pinned notices remain limited to the unfiltered public first page.
