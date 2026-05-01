---
---

Phase 22.1 — adopt changesets as the source of truth for user-facing
version changes.

This is an infrastructure-only entry. No package version is bumped; no
behavior changes. From this commit forward, any user-facing change to a
`@nexpress/*` package should ship with its own `.changeset/` entry so
that when packages flip to public the first release picks up the
accumulated history.
