# Admin agent history

Decision summary of notes extracted from `packages/admin/AGENTS.md` on 2026-09-14.
Use the [Admin reference](../reference/admin.md) for current component guidance.
Git history retains the original dated checkpoints.

# packages/admin — AGENTS.md

Admin is a tsup-built UI package, not a Next application. Agent surfaces reuse
server-owned projections and actions:

- Runtime Studio uses the explicitly installed facade, authority-bound cursors,
  typed editors and existing mutation admission. Unknown usage and unavailable
  operations stay visible as such. See the
  [Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md).
- Activity uses safe run/action projections, with no raw canonical inputs or
  inferred provider facts. Bounded polling stops on terminal state, access loss
  or navigation. See the [Gateway execution flow](../../design/agentic-platform/r4-gateway-execution-flow.md).
- Rollback diffs include only currently declared editable fields. Controls require
  fresh approval for the exact plan/version/hash, preserve unknown-outcome keys
  and clear stale evidence on conflict or access loss. Cancellation reuses the
  existing ChangeSet route. See the [rollback flow](../../design/agentic-platform/r4-rollback-flow.md).

These decisions preserve CSRF, reauthentication, idempotency, CAS and redaction.
Past browser-test totals are not current acceptance; use each flow's evidence and
limits, including separate assistive-technology acceptance.
