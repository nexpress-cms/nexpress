# Core agent instructions

Core owns config, persistence, auth, collections, media, jobs, plugins and host services. Follow the root instructions and read the relevant section of the [Core reference](../../docs/agent-guidance/reference/core.md) before changing these systems.

## Boundaries

- Public entries are in `tsup.config.ts`. Internal imports use relative `.js` paths, never the `index.ts` barrel. Do not add static cycles between jobs and collections/plugins; reuse existing indirection.
- `agent-contract/` and other pure contract entries must not import DB, vault, provider, transport or framework runtime modules. Wire projections exclude secrets, locators, canonical execution input and recovery evidence.
- Initialize observability, DB, cache, storage, collections, plugins and email/producer or worker in the existing bootstrap order; shut down in reverse, observability last. Never read singletons before their setters run.
- Raw setters and registry mutation belong to `@nexpress/core/bootstrap`; application code uses `ensureFor` and domain services. Proxy rate limiting has independent initialization.
- Reuse validated storage object operations, safe observability and `npInvalidateCache()`; do not bypass them with raw adapters or import `next/cache`.
- Read the full collection pipeline before changing it. Use `saveDocument`/`findDocuments` for protected operations; low-level content helpers bypass pipeline hooks/validation.
- Use existing transaction seams and `withDeferredPostCommit`; rollback drops deferred effects. CAS belongs in the atomic write. Never rely on request context across durable jobs: persist/validate `siteId` and register `resolveSiteId`.
- Keep declaration generation bounded: preserve the build's configured heap, explicit service return contracts and shared table/column types rather than exporting duplicated full inferred SQL structures.

## Agent Platform

- Reuse the canonical contracts and owning Connection/Gateway/ChangeSet/Runtime services. Installation is explicit and absence stays disabled; no automatic provider, worker, seed or invented readiness.
- Preserve current requester/viewer authority, item ACLs, immutable evidence, approval bindings, same-site references and fail-closed redaction. Unknown usage is not zero.
- Preview effects, storage I/O, lock ordering, artifact journals and expiry rules are detailed under [Conventions](../../docs/agent-guidance/reference/core.md#conventions); read that section before changing preview or execution.
- For Runtime Studio and current verification, use the [current handoff](../../docs/agent-guidance/current-handoff.md) and linked flow. Historical table counts in the reference are checkpoints, not the current schema inventory.

## Locate the owner

Use [Structure](../../docs/agent-guidance/reference/core.md#structure), [Singletons](../../docs/agent-guidance/reference/core.md#singletons-wiring-order-matters), [Where to look](../../docs/agent-guidance/reference/core.md#where-to-look) and [Internal dependency flow](../../docs/agent-guidance/reference/core.md#internal-dependency-flow) selectively. Earlier implementation notes are [archived](../../docs/agent-guidance/history/core.md); do not preload them.
