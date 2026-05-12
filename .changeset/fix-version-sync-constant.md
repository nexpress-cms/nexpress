---
"@nexpress/core": patch
---

Re-sync `FRAMEWORK_VERSION_FROM_PACKAGE` constant after the 0.1.0 → 0.2.0 fixed-group bump (#666 → #665). The version-sync test caught the drift on the post-merge main CI; this changeset captures the fix so plugin compatibility checks see the correct framework version in published 0.2.x packages.
