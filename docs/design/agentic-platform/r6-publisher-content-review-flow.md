# Publisher content review through ChangeSets

The explicit `npCreateAgentR6UnattendedRecipeRegistryV3()` profile additionally
retains `np.agent-publisher-selection-diagnostic.v2` on the provider-call row
**before dispatch**. Its receipt records frozen criteria/limits, counts, route
coverage and bounded exclusion codes. Its selected-candidate snapshot records
exact resource identities/bases, observation times, findings and content/schema
digests. The request digest and retained classification manifest bind this
snapshot to the existing V3 provider metadata. Raw content/schema and excluded
identities are absent; hidden pipeline losses expose only partial coverage.
The diagnostic expires after 30 days through the existing retention owner.
Original V1/V2 profile/evaluation bytes and V3 provider request bytes are preserved.

The supplied App factory `npCreateAgentPublisherAppRouteInventoryV1()` from
`@nexpress/app/lib/agents/publisher-route-inventory` reuses anonymous collection
and document ACLs and canonical SEO paths with a 2,000-row/route ceiling. Hosts
enumerate static/plugin routes and explicitly declare whether their public surface is
complete; unavailable, changed or truncated sources force partial coverage.
There is no URL fetch or automatic installation. See the
[gap follow-up](r6-goal-gap-audit.md#authorized-implementation-follow-up).

## Boundary

AP-603 ships an explicitly installed `publisher.stale-content` recipe and the
AP-605 Studio draft shortcut. It reviews bounded, currently authorized public
published documents and proposes one ChangeSet for staff review. Importing the
factory, saving a draft, or viewing a report starts no worker, provider, schedule,
or production write. Package versions and changesets are deferred.

The shipped recipe exposes only read, create, validate and preview capabilities.
Runtime enforces the same ceiling even if a host offers additional execution
capabilities. Apply, scheduling, approval and rollback remain the existing staff
review and fresh human approval paths. This bundle does not close real-model
usefulness, the broader AP-606 evaluation gate, or all of R6.

## Host installation and setup

Use `npCreateAgentPublisherRecipeDefinitionV1` from the browser-safe
`@nexpress/core/agent-contract` entry to install the definition through the
existing host recipe registry. `npAgentPublisherRecipeSetupV1` is a draft
suggestion: 180 days stale, at most 50 examined candidate slots and five selected
documents across explicitly selected collections. The initial collection list is
empty. Studio offers the shortcut only when the complete recipe, scopes and modes
are present; the user must select collections before saving.

Automatic candidate context is enabled by the admitted recipe's matching
`publisher.stale-content` instruction template. Existing custom read recipes
with a different instruction template keep their explicitly requested evidence;
sharing the recipe id alone does not inject draft-oriented candidate collection.
The Publisher ChangeSet restrictions still apply by recipe id.

Create the existing framework-owned
`createAgentCoreRuntimeDocumentEvidenceReaderV1` using the host's current user
resolver, block schemas and cursor key. Pass that **same reader** to Runtime
context's `documentEvidence` and ChangeSet service's `publisherEvidence`. The
branded owner supplies the new `publisherCandidates` facet; arbitrary callbacks
cannot replace it. Keep the existing Runtime capability, ChangeSet, preview,
storage and queue installation explicit. Missing preview or evidence is a
readiness/operation failure, never an invented successful preview.

For blocks, the same [App supplier](../../../packages/app/src/lib/agents/publisher-route-inventory.ts) supplies
`npCreateAgentPublisherAppBlockFieldsV1({authorize})`. Its site-id authorization
callback is rechecked around reads; the returned `(siteId, transaction?)` function
implements the reader's optional `resolveBlockFields` seam. It uses the actual
active-site theme/plugin block registry and declared props, recursively handles
arrays and conservatively omits conditional fields. The reader excludes hidden
and undeclared props from content and derives Publisher's embedded props schemas
from those declarations, so generic host schemas cannot reintroduce hidden names.
Nonempty block content without supported declarations fails closed. This does
not enable block editing.

A live delegated staff principal, a verified provider/model, sufficient current
scopes, and `sensitive-approved` provider-data policy and run ceilings are
required. Document content and schema retain this conservative classification
even when the source document is public. The shortcut does not select a provider,
delegate a user, relax policy, register a trigger or activate the Agent. The
original factory supports manual invocation only; explicit unattended V3 allows
manual/scheduled eligibility without installing a trigger. Structured manual input
and an automatic weekly schedule are not installed.

For link checks, optionally provide the read owner's `publisherRouteInventory`
facet with `{siteId, complete, routes: [{path, updatedAt}]}` from the host's
canonical public route inventory. It is bounded to 2,000 unique canonical paths.
Use `complete: false` for partial inventories. No network lookup or model-supplied
URL is executed. Missing/incomplete inventory produces unknown evidence, not a
broken-link conclusion.

An existing route with `updatedAt: null` proves existence but leaves referenced
content freshness unknown, including conflicting route-owner timestamps.

## Selection and evidence

The existing content-query owner selects public/published rows older than the
run's fixed queued time minus `staleAfterDays`. It spends at most `candidateLimit`
slots across the configured collections in canonical collection order, then
ranks that bounded sample by broken internal links, missing SEO metadata, stale
references, age, collection and document id. This is not a whole-site or globally
exhaustive ranking. `truncated` identifies partial sampling/selection or skipped
unavailable evidence.

Both the content-query owner and App route supplier apply the existing
document-aware anonymous read ACL before projection. Denied/currently unavailable
rows reveal no identities, values, ACL reasons or hidden-row counts; candidate
sampling becomes partial when hydration/read admission removes a bounded slot.
The ChangeSet resource owner separately checks delegated staff read/update access
and reads the actual revision/timestamp plus its existing semantic digest, without reserving a draft
id or fabricating a version. Races between the two reads are excluded. Draft,
private, other-site, unscoped, hidden or unavailable document evidence does not
become a candidate. Unsupported timestamps or oversized evidence fail closed or
are explicitly skipped; no unlimited fallback query runs.

Selected schema/content is limited to 48 KiB per document and 256 KiB total.
Framework ids, actual bases and fixed finding codes are separate from untrusted
schema/content in provider context. Existing redaction and request-source
verification re-read the current source before dispatch. SEO checks recognize
declared `seoMetaTitle`/`seoMetaDescription`, `seoTitle`/`metaTitle`,
`seoDescription`/`metaDescription`, and corresponding
`seo` group fields; unknown structures are reported as unknown. Link checks use
structured rich-text links and the explicitly installed canonical inventory;
blocks and unresolved link forms retain unknown coverage.

## Draft, preview and duplicate protection

The provider can complete without a proposal. Otherwise it submits one bounded
`changeset.create` containing nonempty document updates to the current selected
candidates only. The service checks exact bases, visible field shape, configured
batch size, distinct documents and preservation of published target status.
Top-level replacement of groups/arrays with hidden or read-only descendants, and
block values without a field-preservation contract, is rejected so omitted fields
cannot be erased by a later approved apply. Independent visible fields remain
editable. It reuses ordinary resource preparation/validation, current authority, invocation
idempotency, audit and Runtime action attribution. No direct content mutation is
introduced.

The existing action projection supplies ChangeSet ids, draft versions/hashes and
plan hashes for subsequent `changeset.validate` and `changeset.preview` calls.
Get/validate/preview must target the same Run's ChangeSet. Existing Run/Activity
links open Studio review and retained preview evidence. Pending or unavailable
preview must be described as such; a model summary is not execution evidence.

One ChangeSet is allowed per Run. Sorted site/document transaction locks prevent
concurrent Publisher runs from accepting the same document/base. Existing
ChangeSet operations and creator Run attribution enforce a 24-hour cooldown
across agents, principals and idempotency keys; pending review/execution evidence
also blocks the same base after that interval. A changed actual revision/base can
be proposed again. Rejected/cancelled/verified/rolled-back proposals remain
blocked through cooldown. The existing lifecycle keeps the creator/operation
references at least through the one-day minimum Runtime retention window; no
new table, migration, alternate audit log or deletion owner is introduced.

## Provider schema compatibility

The provider validator now accepts the existing ChangeSet owner schemas without
changing their wire contracts: canonical UUID/UTC formats, property bounds,
pattern properties, and productive recursive JSON. All matching property patterns
are checked. Nonproductive references, unsupported keywords/formats, cycles,
accessors and oversized values/schemas still fail closed. The response and actual
installed tool schemas are both checked before capability admission. Runtime also
uses the existing null-idempotency contract for ChangeSet get/list reads, so
preview polling does not accidentally construct a mutation-only invocation key.

## Verification

The 2026-10-15 follow-up passed 50 focused Core cases, eight App supplier cases
and 12 distinct PostgreSQL cases across the new selection and existing Runtime
suites. After adding candidate item ACL checks, the affected PostgreSQL case
passed again; its four name-filtered cases were intentionally not run in that
follow-up. The new two-document journey verifies nested SEO titles/descriptions
and rich-text updates through create, validate and a ready preview, checks the
rendered overlay and exact persisted bases, and preserves both published rows.
Core typecheck, focused typed lint, formatting, relative links and
`git diff --check` passed. These focused results do not replace the combined
bundle's final gate.

The separate `publisher.v3` corpus (`publisher-selection-review:3`) contains eleven
English/Korean source-grounding cases. It supplies the actual V3 instruction and
interactive task/decision wire, consistent selection receipts and exact
schema/content digests. Independent checks cover multiple documents, flat/nested
SEO, rich-text link replacement, stale/unknown-age references, partial evidence,
injection, protected fields and forged resource/base or collateral edits.
`npCreateAgentPublisherSelectionEvaluationSuiteV1()` and its
[pure evaluation contract](../../../packages/core/src/agent-contract/publisher-selection-evaluation-contract.ts)
extend the existing runner/review path without changing V1/V2 datasets. Fake
conformance is not measured model accuracy or broad editorial usefulness; no new
actual provider/model Runtime trial was performed.

The following full-workspace evidence is preserved from the original slice:

- Final `pnpm verify --concurrency=2`: 113 tasks passed, including 2,242 Core
  unit cases. Final `pnpm lint`: 41 tasks passed. Changed-file formatting,
  relative documentation links and `git diff --check` passed.
- Related PostgreSQL acceptance covered 47 files and 405 distinct cases,
  including seven new Publisher Runtime cases and the enabled native preview
  browser case, with no skips. The first run passed 402 cases and exposed two
  custom-read context regressions and one pre-existing test-isolation gap. After
  limiting automatic Publisher evidence to the matching admitted instruction
  template and moving outcome-test cleanup before each case, all 21 cases in the
  three affected suites passed. The 405-case coverage is across these runs, not
  a claim that the original run was green.
- Publisher's actual fake-provider Runtime journey creates, validates, renders
  and reads a ready preview while preserving the published source row. It also
  covers replay, duplicate bases, cross-run access, changed revisions, arbitrary
  targets, stale bases, invalid patches and lost delegated authority.
  Hosted CI exceeded the default 30-second limit for the complete five-turn
  journey; isolated measurement completed it in 22.4 seconds, with about one
  second spent preparing the fixture. That one end-to-end case now has a bounded
  60-second budget. Its assertions, provider turns, real preview processing and
  all other test timeouts are unchanged.
- Final production Chromium acceptance: 27 cases passed, including Publisher
  setup at 390/1280-pixel widths, explicit provider/model selection, capped
  budgets, existing Operator setup, Runtime, Activity and ChangeSet review.
- Fresh packed consumer: all 40 public packages installed from new tarballs.
  Publisher factory/import checks, typecheck including `nexpress.config.ts`,
  schema generation, migrations, Agent foundation, production build and the
  scaffold journey passed. Installed Core/Admin public entry bytes matched the
  verified producer build.

No real provider calls are part of local acceptance. Versioned fake-provider
journeys prove orchestration and boundaries, not model quality. The three live
Redis cases remain skipped in the ordinary workspace gate because
`TEST_REDIS_URL` was not set; this bundle did not rerun the full unrelated
PostgreSQL/theme/Redis matrix or close the full R6 evaluation gate. No repository
package version, changeset, lockfile or migration was changed.
