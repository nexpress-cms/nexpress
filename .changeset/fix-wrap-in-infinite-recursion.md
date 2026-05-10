---
"@nexpress/admin": patch
---

**Fix WRAP_IN reducer infinite recursion** (caught by new editor-engine test suite).

The page-builder's `WRAP_IN` action used `mapTree` to swap a block in
place with a wrapper containing the original. Because `mapTree`
walks every block in the tree — including the wrapper's child,
which is the SAME block with the SAME id — the match condition
fired again on every recursion, wrapping endlessly until the call
stack blew up.

The bug had been silent because admin had no unit test coverage
for the editor engine until #595 — every WRAP_IN-triggering UI
action would have crashed with `RangeError: Maximum call stack
size exceeded`. The contract-rejection paths (wrong type / not a
container / parent excludes the wrapper) all return early before
the buggy `mapTree` call, so the rejected paths "worked".

Fix: replace the `mapTree` walk with `locateBlock` +
`updateContainerChildren`, which performs the substitution exactly
once at the source's depth without recursing into the wrapper's
children. New `reducer — WRAP_IN > wraps a top-level block in a
container` test pins the success path.
