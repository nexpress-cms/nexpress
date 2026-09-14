# Admin agent instructions

Admin owns browser UI and is built with tsup, not Next. Follow the root instructions; consult the relevant section of the [Admin reference](../../docs/agent-guidance/reference/admin.md) before changing a component family.

- UI primitives in `src/ui/` remain boundary-neutral without `"use client"`; stateful views own that boundary. Use existing Radix/cva/cn patterns.
- Consumers import views through `@nexpress/admin/client`, whose build has the client banner. Keep server root/domain imports type-only; runtime validators may come from explicit pure `@nexpress/core/*-contract` entries.
- All data access goes through existing HTTP helpers, including `npFetch` auth/CSRF behavior. Never import server Core runtime or create direct DB/provider access.
- Lazy-load heavy rich-text and block editors through the existing field renderer; do not statically import `@nexpress/editor/client`.
- Preserve `next-shim.d.ts`, relative `.js` imports and existing field renderer contracts. Minimize existing casts and do not introduce new type-error suppression.
- Agent Activity/review uses current server-derived actions, safe projections and item visibility. Do not expose hidden snapshot fields, canonical input or invented usage/readiness.
- Preserve bounded polling, terminal/access-loss stopping and navigation cleanup. Retain idempotency keys for unchanged unknown-outcome retries; discard stale review evidence on conflict/access loss.
- Rollback prepare/request/execute must use the exact existing plan/version/hash and signed approval. Cancellation reuses the existing ChangeSet target contract. No optimistic success or new public verification route.
- Runtime Studio reuses typed contract forms and server admission. Self-delegation and trigger enablement are explicit; unknown measurements stay unknown.

Use [Structure](../../docs/agent-guidance/reference/admin.md#structure) and [Where to look](../../docs/agent-guidance/reference/admin.md#where-to-look) for component locations. The [current handoff](../../docs/agent-guidance/current-handoff.md) links feature status/tests; older notes are [archived](../../docs/agent-guidance/history/admin.md).
