# Roadmap Historical Snapshot

This is a decision summary of the pre-publish roadmap begun on 2026-05-02,
not the current work queue or a release commitment. Git history retains the
original phase lists and completed-feature inventory.

Current implementation contracts live in the [guide index](README.md). Use the
[Agent Platform roadmap](design/agentic-platform/implementation-roadmap.md) for
that track and the [pre-1.0 stability policy](agent-guidance/reference/root.md#stability-pre-10)
for public API commitments.

## Archived context — 0.1 in flight

The original planning window followed the CMS, multi-site, Jobs, WordPress
import and publish-readiness foundation. Its first-publish and CI-billing
questions are obsolete. Current release and verification procedures belong in
[Releasing](releasing.md) and [Testing](testing.md).

## Categories of work between 0.1 and 1.0

The category names and anchors remain for old references. Descriptions below
retain the motivation and architectural decisions, not dated shipped/pending
claims or target versions.

### 1. Publish & feedback loop

Use external installation and production feedback to validate public contracts.
Keep issue intake actionable and support reports reviewable before sharing.
See [Releasing](releasing.md), [Triage](triage.md) and
[Troubleshooting](troubleshooting.md).

### 2. Production hardening

Prioritize observed deployment failures: shared rate limiting, session
revocation, worker health, safe migration and recoverable backups. Operational
state and mutations have existing owners in [Operations](operations.md),
[Deployment](deployment.md), [Jobs](jobs.md) and [Rate limiting](rate-limiting.md).

### 3. Agent-operated operations CLI

The decision was to expose bounded machine-readable plans, stable diagnostics
and explicit execution gates over existing operations. Status, deployment,
migration, backup, release and incident runbooks share this model. Consult
[Agent-operated operations](agent-operated-ops.md) for current commands and
limits; this archive does not authorize deployment or automatic repair.

### 4. Plugin v2 (deferred — likely 1.x)

The v1 boundary is an npm package plus rebuild, with trusted Node execution and
code-generated collection schemas. A registry reload is not module-cache
invalidation or cross-process worker installation. See
[Plugin reload](plugin-reload.md) and [Capabilities](plugin-capabilities.md).

Deferred design questions concern real handler hot reload, worker reconciliation,
anonymous-reader typing, capability-aware SDK types, shared field schemas,
runtime collections and untrusted-code isolation. Runtime capability checks are
not a sandbox. These require concrete author/operator needs and separate design;
the historical version label above is not a delivery commitment.

### 5. Developer experience & ecosystem

Judge the first hour through real generated-project and extension use. The
[plugin quickstart](plugin-quickstart.md), [theme quickstart](theme-quickstart.md),
[WordPress import guide](wordpress-import-guide.md) and [consumer verification](testing.md)
own the current flows. Admin import remains bounded; the CLI owns larger inputs
and full filesystem artifacts.

### 6. API completeness

Provider integrations and public UX should close real gaps without introducing
parallel domain owners. Use the current [authentication](authentication.md),
[email](email.md), [search](search.md) and [community](community.md) contracts;
old placeholder or provider-readiness statements are not a current inventory.

### 7. Stability promotion (Experimental → Stable)

The durable decisions were to version the [rich-text envelope](rich-text.md),
share one [block props schema](plugin-blocks.md) and close the
[theme-token inventory](theme-tokens.md). Raw singleton setters moved behind the
experimental framework-host bootstrap boundary; ordinary domain subpaths retain
reads and operations. The [stability policy](agent-guidance/reference/root.md#stability-pre-10)
owns the current classification and release rules.

### 8. Multi-tenant features (deferred — partial 1.0)

Site identity owns theme selection, sparse plugin activation overrides and quota
admission. Installation remains process-global; missing activation overrides are
active by default. Current authority and deletion rules live in
[Multi-site](multi-site.md) and [Settings](settings.md). Billing remains a separate
extension concern, not an implied Core service.

### 9. Plugin marketplace (deferred — 1.x)

Discovery can be a curated package index with explicit installation instructions.
Automatic installation is a separate design requiring trust, capability
disclosure, migration handling and compatibility with the rebuild model.
Monetization belongs outside the open-source Core. A discovery entry is not
sandboxing, package approval or installation authority.

### 10. First vertical: e-commerce / shop plugin (in progress — v0.x)

Commerce belongs in `@nexpress/plugin-shop`; Core remains a CMS and Storefront
remains independently usable. The [Shop guide](plugin-shop.md) owns the catalog,
checkout, provider, fulfillment, return and notification contracts.

Three design decisions explain the implementation:

- Draft PII uses bounded site-owned plugin storage, outside collection search,
  revisions and content transfer. Generic site deletion is the final boundary.
- Durable orders separate commercial snapshots, short-lived private sidecars and
  maintenance state. Commercial reconciliation must not extend PII retention.
- Shop owns attempts, orders and inventory; provider packages implement optional
  contracts selected through `createShop()`, without parallel persistence.

Completed commerce features and adapter examples are documented once in the
[Shop guide](plugin-shop.md). Its [next slices](plugin-shop.md#next-commerce-slices)
retain the boundaries for further payment, logistics and policy work.

### 11. Docs & marketing

Keep evaluator-facing material tied to working installation, authoring and
migration flows. A docs site or landing page may present those contracts without
creating another manually maintained feature inventory.

### 12. Multi-axis permission model (deferred — 1.x)

The original motivation was scoped grants across sites, collections, kinds,
categories, boards and member surfaces. Do not reuse the old single-axis auth
sketch as a description of today's [multi-site authority](multi-site.md).

Before a broader redesign, validate concrete operator personas and document
inheritance/deny semantics, migration of existing roles, cache invalidation and
Admin grant UX. Evaluate RBAC, ACL and capability models before choosing storage
or API shapes. This archive does not propose a replacement authorization contract.

## Recommended next phase

The original recommendation prioritized real-user feedback, production fixes,
operational commands and developer experience. Preserve that ordering principle;
choose actual work from current evidence and user scope rather than the retired
Phase 23 list.

## Open questions

First publication, old CI billing and the Shop-versus-Core decision no longer
belong to an open-blocker list. Plugin isolation, automatic installation and
broader permission models remain design categories, not approved work. Record a
concrete proposal in its owning design document when an actual use case warrants it.
