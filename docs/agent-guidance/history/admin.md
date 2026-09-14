# Admin agent history

Source: `packages/admin/AGENTS.md`, extracted 2026-09-14. Historical implementation checkpoints; consult only for the affected feature. Later checkpoints and current code may supersede earlier status statements.

# packages/admin — AGENTS.md

**Current Runtime Studio slice:** AP-507 management and related AP-508 visibility
reuse the existing Runtime services and fourteen Admin mutations through an
explicitly installed `runtimeStudio` facade. Closed staff-only read contracts,
authority-bound cursors, typed definition/policy/budget editors, current effective
review and optional atomic activation trigger plans preserve existing admission,
CSRF, reauthentication, idempotency and CAS. Manual admission accepts only the
owned recipe/goal contract and an enabled same-version trigger. Unknown Runtime
usage and unavailable operations remain explicitly unknown; Gateway counters
stay exact. Reference and scaffold routes/pages are thin shared wrappers.
Advanced policy simulation, broader retention and full R5 acceptance remain
open. No migration, provider call, automatic service/worker, seed, default
activation, package version or changeset is added. See the
[Runtime Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md) for scope and verification.

Gateway execution Activity reuses the existing safe run/action projections; never show raw canonical inputs or invented Runtime/provider facts. Active run and ChangeSet detail share bounded backoff polling, stop on terminal/access loss and cancel timers on navigation. All 62 production browser tests passed, including hostile approval HTML/Markdown, typed challenge enforcement and stable unknown-outcome keys across read errors. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks; see the R4 Gateway execution flow.

Rollback controls use existing review.rollbackDetail/rollbackActions and exact same-service contracts. Reuse current declared editable-field projection for restoration diffs; hide undeclared/hidden/read-only snapshot metadata. Request a fresh approval for the exact rollback plan/version/hash; execute only its signed approval. Non-executing cancellation uses the existing ChangeSet cancel route with the rollback-plan discriminator. Keep unknown-outcome keys stable and clear evidence on conflict/access loss. No optimistic success or new public verify route. The preceding rollback slice passed all 60 production browser tests; see the R4 rollback flow results.

Admin UI package: shadcn-style primitives (Radix + Tailwind v4) + CMS views. Built with tsup, not Next.

**Generated:** 2026-04-22 | **Commit:** 2e07135
