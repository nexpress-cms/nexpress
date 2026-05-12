---
"@nexpress/next": patch
---

Restore `nexpress-cms/nexpress` in `@nexpress/next`'s `package.json` `homepage` / `repository.url` / `bugs.url`. The dependabot PR #655 (next 15 → 16 bump) was opened before the org rename PR (#647) and merged after; squash-merging the stale branch silently reset these three fields back to `hahabsw/nexpress`. Sigstore provenance verification rejected the publish with E422 because the URL didn't match the workflow's source repo.
