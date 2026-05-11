---
"@nexpress/cli": patch
---

**theme:install CLI cluster — closes #604, #605, #606.**

Three correctness bugs in the `nexpress theme:install` apply
phase, batched.

**#606 — ENOENT when `src/collections/` is absent.** Projects
without an existing collections directory hit
`writeFileSync(.../missing-dir/posts.ts)` ENOENT on the first
`theme:install`. Added `mkdirSync(dirname(target), {
recursive: true })` before the write so the bare-scaffold path
succeeds.

**#605 — created collection files were dead code.** The runner
wrote `src/collections/<slug>.ts` but never touched
`nexpress.config.ts`. The new file's `defineCollection()`
export was unreferenced — bootstrap and schema generation only
see collections listed in the config's `collections` array, so
the install silently left the theme requirement unsatisfied.

Fix: print a structured manual-step block after the apply
phase, listing each newly-created collection's exact import
line + array entry. The "Next" section also renumbers to call
out the registration step. Marker-based AST editing of
`nexpress.config.ts` (mirroring `nexpress plugin add`) is the
cleaner long-term shape but adds ~100 LOC of new infrastructure
that doesn't pay off until a plugin actually needs it — defer.
The print-and-fail-loud path is what the issue's "Expected"
section explicitly allows.

**#604 — patch-collection targeted `<slug>.ts` instead of the
discovered file path.** The planner extracted each collection's
real `filePath` (so a collection authored at `blog-posts.ts`
with `slug: "posts"` was correctly discovered), but the apply
phase reconstructed `src/collections/${slug}.ts` and patched
that — meaning operators with non-standard file names had a
ghost `posts.ts` written instead of their `blog-posts.ts`
getting the new fields.

Fix: build a `slug → filePath` map from the discovered list
and pass it into `applyPlan`. `patch-collection` steps prefer
the discovered path; the legacy `<slug>.ts` fallback survives
only for the defensive case where a `patch-collection` step
references a slug discovery didn't surface (shouldn't happen,
but mirrors the safer pattern already in `theme:uninstall`).

No new tests — these are CLI runner paths that the existing
`run.test.ts`-style integration suites don't cover (they
test plan computation, not apply). Manual smoke is sufficient
given the size; full e2e for theme:install is a follow-up.

All 82 existing `@nexpress/cli` tests still pass. Repo
typecheck + lint clean.
