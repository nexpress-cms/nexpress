# Root agent history

Decision summary of the implementation notes extracted from `AGENTS.md` on
2026-09-14. Current contracts and acceptance status live in the linked guides;
this archive is not a release checklist. Git history retains the dated work log.

# AGENTS.md

## Agent Platform boundaries

The platform was built in stages around existing framework authority and domain
services. Each later stage reuses the previous admission, persistence and audit
contracts rather than creating another execution path.

| Area                            | Preserved decision                                                                                                                                                                                                                                                                        | Contract and evidence                                                                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical and Admin contracts   | Browser-safe, closed registries own body validation, operation metadata, fingerprints and redaction. Server credentials and recovery evidence never enter client projections.                                                                                                             | [Canonical contracts](../../design/agentic-platform/canonical-contracts.md), [Admin contracts](../../design/agentic-platform/admin-agent-studio.md)                                                                                                                 |
| Identity, Vault and connections | Persist same-site authority and immutable credential bindings. Use explicit host adapters, single-use secret material and inspection before retrying ambiguous provider effects. Outbound connections and inbound Gateway authority remain separate.                                      | [Security and credentials](../../design/agentic-platform/security-and-credentials.md), [data model](../../design/agentic-platform/data-model.md)                                                                                                                    |
| Gateway and MCP                 | Capabilities derive from one descriptor registry and the intersection of deployment, site, credential, scope and current actor authority. Inline reads do not invent Runs. Stdio remains protocol-only; remote transport is same-origin and uses dedicated credentials.                   | [Gateway guide](../../agent-gateway.md), [client integration](../../agent-integration.md), [capabilities and MCP](../../design/agentic-platform/capabilities-and-mcp.md)                                                                                            |
| ChangeSets and preview          | Drafts, validation and preview bind to exact versions and current authority. Read-only overlays block framework effects; private artifacts require complete verified evidence before readiness.                                                                                           | [ChangeSets and approvals](../../design/agentic-platform/changesets-and-approvals.md), [R3 review](../../design/agentic-platform/r3-draft-foundation-review.md)                                                                                                     |
| Approval and execution          | Fresh approvals bind exact plans. Apply reuses transaction-aware domain writers, one durable journal and host-invoked verification. Unknown effects remain fenced.                                                                                                                        | [Approval flow](../../design/agentic-platform/r4-approval-flow.md), [execution flow](../../design/agentic-platform/r4-execution-flow.md), [Gateway execution](../../design/agentic-platform/r4-gateway-execution-flow.md)                                           |
| Rollback                        | Preserve original apply evidence. Derive compensation from verified snapshots and current after hashes, recheck authority and consume a fresh approval. Snapshot restore variants belong only to rollback operations. Unresolved effects fence new generations and site deletion.         | [Rollback flow](../../design/agentic-platform/r4-rollback-flow.md)                                                                                                                                                                                                  |
| Runtime                         | Explicitly installed services own admission, quota reservations, usage and emergency controls. Local deployment authority is not a staff actor; delegation requires a real current staff principal. Run rows are the schedule outbox and recovery does not recharge initial reservations. | [Foundation](../../design/agentic-platform/r5-runtime-foundation-flow.md), [delegated execution](../../design/agentic-platform/r5-runtime-delegated-execution-flow.md), [events and operations](../../design/agentic-platform/r5-runtime-events-operations-flow.md) |
| Runtime Studio                  | Management reuses the Runtime facade, authority-bound reads, typed editors, CAS and existing Admin mutations. Unavailable operations and unknown usage stay explicit.                                                                                                                     | [Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md)                                                                                                                                                                                              |

Agent services, provider adapters and workers require explicit host installation.
Disabled deployments remain healthy without seeded authority or automatic
activation. Diagnostics expose safe aggregates, never raw credentials, canonical
inputs or invented provider/Runtime facts. A completed slice does not establish
full milestone acceptance; consult the [roadmap](../../design/agentic-platform/implementation-roadmap.md)
and [R5 acceptance gate](../../design/agentic-platform/r5-acceptance.md).

## Commerce and community

[Shop](../../plugin-shop.md) grew through independent catalog, cart, checkout,
payment, fulfillment, return, exchange and notification contracts. State in one
contract is not proof that another completed. Preserve these boundaries:

- Integer money, immutable commercial snapshots, site/owner isolation, revisions
  and durable idempotency bind each transition. Inventory changes are atomic.
- Provider I/O stays outside database transactions. Durable confirmation precedes
  local finalization; uncertain results reconcile before retry or compensation.
- Private addresses and recipient data have separate bounded lifetimes. Safe
  Admin, Doctor and owner projections do not extend PII retention. Notifications
  use durable outboxes; generic email remains at-least-once without provider receipts.
- Carrier booking, packing, parcel selection, tracking, labels and pickup are
  separate capabilities. Packing evidence does not prove shipment completion;
  tracking closes cancellation/restock paths. Label voiding does not imply shipment
  cancellation or a carrier refund. Additive adapter versions preserve v1 fallback.
- Payment disputes are evidence and action gates, not automatic refunds or changes
  to inventory. Refund allocation, return receipt and replacement shipment keep
  their own explicit transitions and authority.
- Shop, Forum and Storefront remain independently usable. Wishlists, stock alerts,
  price alerts, reviews and contextual Q&A do not grant checkout or inventory rights.

[Community](../../community.md) and [Forum](../../plugin-forum.md) use site-scoped
member authority, explicit document audiences and shared moderation policy.
Attachments reuse media ownership and current target visibility. Skins and themes
consume public hooks and retain independent fallbacks. Realtime streams carry
PII-free invalidation, bounded queues and resumable cursors, with polling fallback
and bounded retention.

## Shared framework contracts

The common refactor established one validated contract at each boundary. Reuse its
owner rather than duplicating wire parsing, persistence rules or diagnostics.

| Boundary                                                                             | Current guide                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intent-based bootstrap, singleton lifecycle and explicit host wiring                 | [Bootstrap](../../bootstrap.md), [Core reference](../reference/core.md)                                                                                                                  |
| Site identity, persisted membership, quotas and dependency-safe deletion             | [Multi-site](../../multi-site.md), [settings](../../settings.md)                                                                                                                         |
| Collection definitions, partial-update storage, hydration and item ACLs              | [Collection documents](../../collection-documents.md)                                                                                                                                    |
| Revision/autosave snapshots and restore                                              | [Revisions](../../revisions.md)                                                                                                                                                          |
| Recursive block wire, placement, schema-derived props and preserved inactive content | [Block content](../../block-content.md), [plugin blocks](../../plugin-blocks.md)                                                                                                         |
| Rich-text envelope and safe rendering                                                | [Rich text](../../rich-text.md)                                                                                                                                                          |
| Theme definitions, token validation and source-owned route registration              | [Theme authoring](../../theme-authoring.md), [tokens](../../theme-tokens.md), [custom routes](../../custom-routes.md)                                                                    |
| Navigation, locale catalogs and validated translation interchange                    | [Navigation](../../navigation.md), [i18n](../../i18n.md), [plugin i18n](../../plugin-i18n.md)                                                                                            |
| Media ownership, storage and background payload site identity                        | [Media](../../media.md), [jobs](../../jobs.md)                                                                                                                                           |
| Awaitable cache invalidation and bounded adapter failures                            | [Caching](../../caching.md), [observability](../../observability.md), [rate limiting](../../rate-limiting.md)                                                                            |
| Search visibility, latest-state indexing and serialized cursor reindex               | [Search](../../search.md)                                                                                                                                                                |
| Validated metadata and public discovery                                              | [SEO](../../seo.md), [public discovery](../../public-discovery.md)                                                                                                                       |
| Plugin definitions, typed hooks, routes and UTC scheduled work                       | [Manifest](../../plugin-manifest.md), [hooks](../../plugin-hooks.md), [API routes](../../plugin-api-routes.md), [pages](../../plugin-pages.md), [tasks](../../plugin-scheduled-tasks.md) |

Plugin installation is process-global; activation is site-specific through sparse
overrides. Durable plugin jobs carry the target site. Raw callbacks leave provider
signature, replay and idempotency policy with the plugin. Binary responses are
bounded and validated; GET registrations also serve bodyless HEAD responses.

## Compatibility and operations

- Public framework identifiers use `np`/`Np`/`NP_`/`np_`/`np-`/`--np-`;
  package names remain `@nexpress/*`. Existing internal `nx:*` cache/Redis contracts
  are preserved where required.
- Node.js 20.19.0 is the supported minimum. Generated projects and extensions
  must validate their own source graph and refresh generated collection code.
- Built-in OAuth providers use provider-specific authorization-code and S256 PKCE
  implementations. The deprecated structural `fromArctic` adapter remains the
  compatibility path for existing custom integrations.
- Definition-time plugin Admin actions coexist with setup-time
  `ctx.actions.register*`. The never-implemented custom-field registration surface
  was removed rather than retained as a promise.
- Support reports remain local, bounded and secret-free; sharing requires review.
  See [triage](../../triage.md).
- Release acceptance uses packed consumer builds and published manifest/provenance
  checks. Historical success counts do not authorize publication or a version
  change. Follow [release guidance](../../releasing.md) and the user's current scope.
