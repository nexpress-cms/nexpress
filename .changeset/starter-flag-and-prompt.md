---
"create-nexpress": patch
---

Add an interactive starter prompt to `create-nexpress` and a friendlier `--starter=<id>` flag (alias for `--theme`). Picks one of `blog`, `magazine`, `portfolio`, or `docs` at scaffold time and writes `NP_ADMIN_THEME` to `.env`, which the first-boot admin setup wizard reads as the picker's initial selection. The existing `--theme` flag still works.
