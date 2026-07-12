---
"@nexpress/core": patch
---

Align project-config validation with runtime plugin loading and storage URL
construction. Resolved plugins may depend on successfully loaded legacy
plugins, dependents skip failed setup prerequisites, storage base URLs reject
non-appendable credentials/query/fragment forms, and root local-media URLs
remain valid.
