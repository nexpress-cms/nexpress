# Web agent history

Decision summary of notes extracted from `apps/web/AGENTS.md` on 2026-09-14.
Use the [Web reference](../reference/web.md) for current ownership and commands.
Git history retains the original dated checkpoints.

# apps/web — AGENTS.md

The reference app supplies local configuration, collections, generated schema and
package wiring. Shared `@nexpress/app` implementations own route handlers, pages,
scripts, proxy behavior and setup flows; generated scaffolds use the same wrappers.

Agent work kept that division intact:

- Runtime status, pause and reviewed resume use one thin local CLI wrapper.
  The deployment actor fingerprint is environment-only. Missing readiness blocks
  resume while status and pause remain available. See the
  [foundation flow](../../design/agentic-platform/r5-runtime-foundation-flow.md).
- Runtime jobs and delegated execution require explicit host installation;
  wrappers do not construct provider adapters, workers, schedulers or authority.
  See [events and operations](../../design/agentic-platform/r5-runtime-events-operations-flow.md)
  and [delegated execution](../../design/agentic-platform/r5-runtime-delegated-execution-flow.md).
- Studio, Agent HTTP and MCP reuse shared facades and entrypoints. Activity uses
  the injected ChangeSet read owner and safe projections. See the
  [Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md) and
  [Gateway execution flow](../../design/agentic-platform/r4-gateway-execution-flow.md).
- Rollback preparation, approval and execution routes remain shared-app exports;
  cancellation reuses the existing ChangeSet route. See the
  [rollback flow](../../design/agentic-platform/r4-rollback-flow.md).

Historical migration/table inventories and suite totals are superseded by current
schema and acceptance gates. Empty scaffolds must remain disabled without seeded
Agent settings, implicit credentials or automatic activation; verify that boundary
through the [packed-scaffold and integration checks](../../testing.md).
