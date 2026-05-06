---
"@nexpress/admin": patch
---

`WRAP_IN` and `WRAP_MANY` now check the parent container's
contract before wrapping. Previously, only the wrapper-accepts-
source side was checked — wrapping a `text` block inside a
`column` whose `allowedChildTypes: ["text"]` into a `grid` would
make the column hold a `grid` child, which the column's contract
forbids. The reducer rejects the wrap closed instead of building
an instantly-invalid tree.

Preview-iframe `scrollIntoView` now targets the marker's first
element child instead of the marker itself. The marker uses
`display: contents` to stay layout-neutral, but a box-less
element is historically unreliable as a `scrollIntoView` target
(descendant fallback works in modern Chrome / Firefox; Safari has
had bugs around this). The new target is the same node the
outline CSS hits via `> *`, so highlight and scroll stay aligned.
