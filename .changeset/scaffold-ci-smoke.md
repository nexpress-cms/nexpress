---
"create-nexpress": patch
---

CI now runs an end-to-end scaffold smoke job: it builds the CLI, scaffolds a fresh project via `node dist/index.js`, installs deps, and typechecks the result. Catches regressions the unit tests on `getProjectFiles` can't reach — missing deps in the emitted `package.json`, broken stubs, snapshot drift.
