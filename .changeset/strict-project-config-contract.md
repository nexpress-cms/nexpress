---
"@nexpress/core": minor
---

Make `defineConfig()` an exact project configuration boundary. Unknown or
retired settings now fail at module evaluation, active nested settings are
strict, and shared tooling APIs validate site origins, storage URLs, canonical
locale inventories, duplicate plugin ids, and missing or cyclic plugin
dependencies.
