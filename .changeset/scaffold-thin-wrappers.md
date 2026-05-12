---
"create-nexpress": minor
---

Scaffolded projects now produce byte-identical code to `apps/web` by mirroring `apps/web/src/{app,lib,i18n.config.ts,proxy.ts}` into the new project as a snapshot. The old string-template admin/site/api/lib files in `templates/{admin,site,api,lib}/` (which had drifted from the reference app) are gone. `npx create-nexpress` and `apps/web` now both resolve to the same handlers via `@nexpress/app`'s subpath exports — adding `@nexpress/app` as a scaffold dependency is the operative change.

`getProjectFiles` now returns `Record<string, TemplateFile>` instead of `Record<string, string>` to carry an encoding flag — required for the (single) binary file in the snapshot (`icon.svg`). Existing consumers that iterate the map need to read `.content` per entry.

New `pnpm sync-snapshot` script in `create-nexpress` resyncs `templates/snapshot/` from `apps/web/src` whenever the reference app's wrappers change. Run it from the monorepo root after editing apps/web's wrappers and commit the diff alongside.
