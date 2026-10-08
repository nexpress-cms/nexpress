# Core agent history

Decision summary of notes extracted from `packages/core/AGENTS.md` on 2026-09-14.
Use the [Core reference](../reference/core.md) for current implementation guidance
and [root history](root.md#agent-platform-boundaries) for shared platform decisions.
Git history retains the original dated checkpoints.

# packages/core — AGENTS.md

Core owns the server-only CMS engine and the authoritative collection, storage,
job, policy and Agent services. Historical Agent work preserved these boundaries:

- Runtime admission, configuration and deletion share the site quota lock.
  Deployment authority never becomes a staff actor implicitly; live membership
  and item access are rechecked for delegated work.
- Pause remains available without provider/worker readiness. Local resume requires
  its persisted, expiring reviewed plan and current readiness fingerprint.
  Runtime control settings stay outside portable content. See the
  [foundation flow](../../design/agentic-platform/r5-runtime-foundation-flow.md).
- Delegated execution reuses ChangeSet, approval, invocation and execution owners.
  Immutable requested actions are fulfilled only by exact approved-execution
  receipts; membership removal/regrant invalidates old authority. See the
  [delegation flow](../../design/agentic-platform/r5-runtime-delegated-execution-flow.md).
- Run rows own the schedule outbox; durable event/schedule progress and fair
  cursors preserve healthy work across sibling failures. Recovery does not repeat
  initial quota charges. See the [events and operations flow](../../design/agentic-platform/r5-runtime-events-operations-flow.md).
- Gateway execution and rollback preserve immutable journals and same-service
  read authority. Unresolved effects remain fenced; SQL serialization/deadlock
  conflicts use the existing safe conflict envelope. See the
  [Gateway flow](../../design/agentic-platform/r4-gateway-execution-flow.md) and
  [rollback flow](../../design/agentic-platform/r4-rollback-flow.md).
- Studio is an explicitly installed facade over the same services, not a second
  runtime. Unknown usage stays unknown. See the
  [Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md).

Migration inventories and test counts belonged to individual checkpoints and are
not current schema or acceptance claims. The [roadmap](../../design/agentic-platform/implementation-roadmap.md)
and feature acceptance documents own remaining scope.
