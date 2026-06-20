---
"@nexpress/cli": patch
"create-nexpress": patch
---

Make local plugin scaffolds work cleanly inside fresh `create-nexpress` projects by reserving `packages/plugins/*` as a workspace, inheriting the site's installed NexPress dependency ranges, generating the correct plugin `tsconfig` extends path, and adding CI smoke coverage that creates, installs, typechecks, and builds every plugin starter.
