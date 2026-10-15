# R6 explicitly installed unattended recipes

The optional R6 installation profiles permit bounded event or scheduled
read/proposal work through the existing Runtime owners. It preserves the shipped
manual recipe definitions and their instruction, settings, response-schema and
evaluation bytes. Constructing the profile starts no service, trigger, worker or
provider. This flow does not establish real-model usefulness or full R6 acceptance.

## Installation and immutable profiles

Hosts explicitly call `npCreateAgentR6UnattendedRecipeRegistryV1()` from
`@nexpress/core/agent-contract` and pass its complete registry to their existing
Runtime service installation. The pure
[factory](../../../packages/core/src/agent-contract/r6-recipe-registry.ts) creates
independent definitions with the original three factories and changes only the
allowed trigger kinds:

| Recipe                         | Shipped manual factory | Optional unattended profile |
| ------------------------------ | ---------------------- | --------------------------- |
| `moderator.repeated-link-spam` | manual                 | event, manual, schedule     |
| `operator.worker-not-draining` | manual                 | manual, schedule            |
| `publisher.stale-content`      | manual                 | manual, schedule            |

In the V1 profile, recipe and instruction versions remain one. Capabilities, provider requirements,
settings, schemas and instruction bytes are unchanged. Both trigger sets and
recipe entries use canonical ordering. Hosts install one complete profile;
combining the manual and expanded definitions for the same `(id,version)` is an
invalid duplicate, not a mechanism for granting both independently.

The existing canonical definition and complete-registry projections include
`triggerKinds`. Expanded definitions therefore have their own exact fingerprints.
The [contextual canonical owner](../../../packages/core/src/agent-contract/canonical-recipe-registry.ts)
requires the exact installed array when computing either projection: an original
manual definition is not a member of the expanded installation snapshot, and a
partial registry is not a complete installation. No parser, purpose or existing
golden vector is changed to accept a new recipe version.

An Agent version retains its complete registry and configuration fingerprints.
Previously saved versions and admitted Runs keep their original bytes; installing
another profile does not rewrite them or grant new trigger eligibility. Activation
rechecks the current definition fingerprint. To adopt the new profile, save a new
draft and explicitly activate that reviewed version through the existing service.
Do not silently rehash an old draft or migrate active authority. The existing
[Runtime version owner](../../../packages/core/src/agent/runtime-service.ts) and
[admission owner](../../../packages/core/src/agent/runtime-admission.ts) reconstruct
retained bodies independently of a newer installation.

Provider selection, staff delegation, policy and budget configuration, Runtime
enablement, Agent activation, trigger registration/enablement and host job
installation remain separate explicit operations. The factory does not perform
any of them. Normal request processing does not start a model process or wait for
inference.

### Optional Publisher uncertainty instruction

`npCreateAgentR6UnattendedRecipeRegistryV2()` preserves the V1 trigger eligibility
and all Moderator/Operator bytes, while selecting the explicit Publisher
uncertainty instruction profile. The recipe wire and `recipeVersion` remain one;
only Publisher's instruction `templateVersion` becomes two with a different digest.
The manual V1 factory and unattended V1 registry remain byte-for-byte unchanged.
V1 and V2 are alternative complete installations, never duplicate same-id members.

The new instruction requires incomplete checks to be described as unverified,
rather than claiming content/links are normal because no ChangeSet was produced.
It preserves independently justified improvements, capability ceilings and all
existing activation/current-authority rules. New profile construction still
installs nothing; adopting it requires a newly saved, explicitly activated draft.
The [Publisher evaluation flow](r6-publisher-evaluation-flow.md#explicit-uncertainty-profile-and-v2-evaluation)
records the separate V2 benchmark and unchanged historical artifacts.

## Actual Moderator evidence before admission

The [event service](../../../packages/core/src/agent/runtime-event-service.ts)
accepts an optional `moderatorCollector` supplied by the host. A host may use the
existing `createAgentModeratorCombinedContentCollectorV1()` with its current staff
and Incident write owners. The
[collector](../../../packages/core/src/agent/moderator-combined-collector.ts) reuses
actual observed comments, comment reports and document reports through one global
100-Event scan. It resolves current source facts and author independence before
writing an advisory Signal/Incident; report claims never become classifier verdicts
or account response authority.

Collection is bounded to one closed 600-second bucket:

- Event dispatch selects the bucket containing the persisted source Event's
  `occurredAt`. An open bucket is unavailable; the original Event stays pending
  for a later explicit worker retry.
- Schedule dispatch selects the closed bucket immediately preceding the exact
  planned `scheduledFor` occurrence. A delayed retry uses that same occurrence,
  not whichever bucket happens to precede the retry's current clock.
- Source collection runs outside the Runtime-control transaction. Its existing
  owner takes ordered locks and rechecks staff/site/source authority. Trigger,
  Agent version, policy, budgets and delegated authority are rechecked before Run
  admission. Collection itself grants no execution permission.

If collection fails, that attempt creates no Run or provider call. The Event
dispatch marker or scheduled occurrence remains pending rather than silently
advancing past missing evidence. Current-source attestation is repeated by Runtime
context preparation and capability proposal/execution; a source change after
collection cannot authorize an old target.

The option is absent by default. Its addition does not install an observer,
collector, Incident service or worker and does not change unconfigured hosts.

## Durable dispatch and replay

Events and scheduled occurrences reuse the existing site-stamped Run outbox,
coalescing and idempotency keys. A confirmed Run can be reconciled after enqueue
failure without admitting another Run or calling a provider during the global
recovery scan. Execution uses the existing Runtime executor and host-installed
`agent:runExecute` job contract.

Before collecting again for an exact existing Run, the service rechecks its live
Run authority and uses the retained admission. A fresh collector failure cannot
replace that Run's evidence or block a valid coalesced replay. Conversely, loss of
current authority still fails closed. Terminal executor replay does not repeat
provider work or mutations.

The existing [job owner](../../../packages/core/src/agent/runtime-jobs.ts) remains
explicitly registered by the host; new trigger eligibility does not start or
enable it. Queue delivery, reconciliation and normal Runtime state/usage evidence
keep their existing owners.

## Response ceilings

Moderator still proposes exact content quarantine through the existing fresh,
hash-bound human approval. Automatic quarantine, content deletion, permanent bans
and Member account actions are not added. Replaying the approved continuation
preserves one containment receipt.

Publisher still creates, validates and previews only its bounded ChangeSet draft.
Public content is unchanged until a separate human-approved execution. Current
base/ACL checks and same-document/revision cooldown apply equally to scheduled
Runs. Schedule eligibility is not publication-schedule or apply authority.

Operator still reads deterministic observations and prepares an owner-backed local
review plan. The recipe has no `ops.execute`, shell or SQL capability. The separate
approved execution owner retains its closed action set; queue-global drain or
restart instructions remain local human handoffs.

## Verification ownership

The new [pure profile suite](../../../packages/core/src/agent-contract/r6-recipe-registry.test.ts)
checks original manual bytes, separate exact fingerprints, contextual membership,
duplicate-profile rejection and result isolation. The original recipe and frozen
evaluation-hash suites remain the authority for their existing bytes.

The [PostgreSQL unattended suite](../../../apps/web/tests/agent-r6-unattended.integration.test.ts)
uses real admission/context/executor, persisted source and capability owners with
local fake inference. Its five coherent journeys cover:

1. Publisher scheduled draft/ready preview, unchanged public content, replay and
   same-base cooldown.
2. Moderator exact-occurrence collection failure/retry, first persisted Signal and
   one fresh human-approved quarantine.
3. Actual comment Events, pending failed collection, retry, same-target edit
   coalescing and retained-Run replay despite later collector failure.
4. Operator scheduled read/plan, no execution and a budget-blocked occurrence that
   remains retryable without another Run or provider call.
5. Changed Publisher source and revoked delegated authority refusing further
   effects/provider dispatch.

After dependency builds, the coordinator runs the affected suite against an
explicit isolated PostgreSQL fixture:

```sh
pnpm --filter @nexpress/web exec vitest run tests/agent-r6-unattended.integration.test.ts
```

On 2026-10-15, the completion working tree passed all five new journeys and
54 existing Runtime-event, Publisher, Operator, Moderator and document-recipe
cases against an isolated PostgreSQL 18.3 fixture: 59/59, no skips. The four new
pure profile cases and the original recipe/hash suites passed together (24 cases).
Source and fixture typechecking passed with an explicit test-inclusive project
because ordinary Web typechecking excludes integration files.

The final complete Web run also covered the strengthened stored-registry,
explicit duplicate-proposal error and delayed original-occurrence assertions.
See the complete-plus-corrected 1,677-case local coverage and separately enabled
native preview in the [acceptance record](r6-acceptance.md).

These local fake-inference results do not establish external provider behavior,
a production shadow period or full R6 acceptance. The
[current acceptance decision](r6-acceptance.md) owns the complete final local gate;
the [evaluation report boundary](r6-evaluation-report-flow.md#remaining-acceptance-and-operating-boundaries)
continues to distinguish local evidence from real-model usefulness.
