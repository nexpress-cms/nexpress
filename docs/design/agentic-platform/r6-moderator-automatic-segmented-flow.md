# Explicit automatic quarantine and segmented Moderator assessment

## Scope and installation

These are independent opt-in extensions. Segmented semantic assessment remains
read-only. It cannot authorize automatic quarantine. The existing human-approved
quarantine/restore capabilities and V1 assessment/evaluation identities remain
unchanged. Neither extension installs a provider, worker, credentials, trigger or
Runtime, and neither is enabled by a document import or an advisory score.

Actual provider/model Runtime validation is excluded by the current user
instruction. Local fixtures can establish contract, persistence and execution
behavior with fake inference and simulated host approvals; they do not establish
production precision or qualify a real automatic policy.

## Automatic quarantine

The host creates `createAgentAutomaticQuarantineAuthorityV1` with one immutable,
versioned site/policy/locale deployment artifact, a current deployment
approval/revocation verifier and an authoritative content-locale reader. It
passes that branded owner as `automaticQuarantine` to the existing moderation
service. Its host-only `automatic.invoke` supports `quarantine` and
`restore_expired`; no approval-free HTTP/MCP capability is registered.

The deployment artifact binds a reviewed blocked-domain hash, independent
account/item thresholds, source age, exact principal/collection scope, hourly
and active-containment ceilings, expiry and compensation evidence. Qualification
requires the unchanged [production enablement gate](testing-and-evaluation.md#93-enablement-gates):
99.5% reviewed precision, a one-sided 95% Wilson lower bound of at least 99.0%,
1,000 reviewed predicted positives and 1,000 legitimate hard negatives per
policy/locale, and fourteen days of production shadow. The trusted host verifier
must separately authorize the exact artifact digest. Self-asserted JSON, a model
score, the existing advisory count score and synthetic offline results grant no
execution authority.

Before an effect, the owner re-reads canonical Incident/Signal/Event evidence,
current content and locale, verifies the configured deterministic rule and
current target version, and intersects current capability admission, staff
permissions, policy and budgets. Before quarantine, it also requires the exact
restore policy to allow compensation and the trusted host verifier to attest that
the durable compensator is registered and operating. Both policy digests are
bound to the original invocation/audit and rechecked around the effect. A policy
that already prevents expiry restoration cannot admit a new TTL quarantine.
Existing domain quarantine/restore, collection
ACLs/hooks/revisions, CAS, verification, deferred effects, Action/Containment and
normal audit owners perform the mutation. Automatic authorization is separately
retained; no human Approval is synthesized or consumed. Repeated requests use
existing durable invocation and exact output bindings.

An automatic quarantine records a finite containment expiry. The host explicitly
registers `createAgentAutomaticQuarantineExpiryProcessorV1` with its existing
durable scheduler to compensate expired content. The processor validates persisted
`siteId`/cursor/limit, supplies `resolveSiteId`, obtains current authentication from
the host and scans at most 100 matching deployment containments. It calls the same
`restore_expired` owner and reports blocked items while preserving their active
containment and rollback evidence. No timer or worker starts merely by constructing
the service. Restoration
uses the exact recorded original state and current version. Changed content or
missing authority fails closed instead of overwriting newer work. Ordinary fresh
human-approved restoration remains available through the existing capability.
Keep a deployment's compensator registered until its active containments finish;
revoking permission for new quarantines can leave compensation separately allowed.
The expiry scan is scoped to the authenticated originating principal, so a host
registers the corresponding current authority for each selected principal.

## Large-Incident semantic assessment

Hosts select `npCreateAgentR6AssessmentRecipeRegistryV2` explicitly. This supplies
Moderator assessment instruction version 2 while preserving the original V1
profile. The existing branded source and recorder select the implementation from
the admitted recipe; existing Agents require their ordinary draft/activation
process to adopt it.

The source binds the complete authorized canonical evidence union to one stable
manifest. Its limits are 100 Signals, 10,000 Events, 1,000 content targets and
100 segments. Each provider request contains at most ten current targets and
2,000 characters per excerpt. For example, 151 targets require sixteen segments
when the configured budgets permit them. Missing, stale, inaccessible, oversized
or conflicting evidence cannot become a complete whole-Incident verdict.

Provider-call rows are durable continuation checkpoints. Ordered successful
segments must share exact Incident/version, manifest, profile, policy, request
and source bindings. Retries remain bound to the same segment; an ambiguous or
failed segment cannot be skipped. Each paid attempt still passes normal
provider/token/cost/call budgets and the analysis budget owner. The implementation
does not increase site or Agent ceilings. A low configured ceiling can stop a
large analysis; successful partial calls remain in the Run ledger and are not
presented as full coverage.

Only the verified aggregate is recorded as an `agent_assessment` timeline entry.
It links all exact segment call proofs and reports coverage independently of the
model classification. Disagreement or uncertain/incomplete evidence yields an
uncertain aggregate. Studio verifies these proofs before projecting the separate
`segmentedAssessment` field, shows batch/target coverage and links the Run. V1
assessment wires and display remain valid. An aggregate is an advisory model
judgment, not a deterministic fact, calibrated probability or approval.

V2 request diagnostics contain only bounded source metadata and digests, never
raw excerpts. They are required aggregate/continuation proof and remain with the
owning provider-call lifecycle. Ordinary response diagnostics still expire. The
[retention matrix](r6-history-retention-flow.md) continues protecting active work,
unknown outcomes and required audit/approval/rollback evidence.

## Verification

Completed on 2026-10-15 with fake inference and explicitly simulated trusted host
approval. Independent review and self-review corrected stale-source campaign
continuation, prior-segment projection drift, missing compensation preflight,
expiry scans crossing principal scope and exact V2 instruction identity. None of
these checks establishes a real production deployment artifact or model quality.

- Full `pnpm verify --concurrency=2` passed 113 tasks. After the final exact-profile
  guard correction, filtered Core `pnpm verify` passed all three tasks, including
  2,417 unit cases. The final web production build/typecheck and five explicitly
  included test/fixture TypeScript entrypoints passed. Versions, changesets,
  lockfile, schema and migrations are unchanged.
- `pnpm lint` passed all 41 tasks on the final code. Source formatting, local
  documentation links, secret/type-suppression review and `git diff --check`
  passed; the pre-existing handoff change was preserved.
- Core PostgreSQL passed 63 cases without skips. The full Web PostgreSQL run
  covered 206 files and 1,759 cases: 1,750 passed and nine Sitemap assertions
  failed because the local runner supplied the browser's port instead of the
  integration suite's fixed `http://localhost:3000` origin. The reference-fence
  file's 28 cases passed but its cleanup hook timed out while the temporary
  PostgreSQL cluster waited in `DROP DATABASE` / `ProcSignalBarrier`. Both files
  were rerun on a clean PostgreSQL 18 cluster with synchronous I/O and the correct
  origin: 43/43 passed, including cleanup. This is full-plus-corrected coverage,
  not a claim that the first full command exited green. All 24 automatic, eight
  segmented and one proof-retention cases passed in the full run. Theme suites
  and the explicitly enabled native-preview Chromium case were included.
- Live Redis passed 16 cases. The final production browser run passed 127/127
  without retries or skips. New full/incomplete-coverage UI captures were
  inspected at 390px and 1280px. The long isolated media path exposed an existing
  mobile Health detail overflow; its text now shrinks and wraps, and all mobile
  routes passed with that same long path.
- Forty packed public packages passed 59 fresh-consumer stages, including plain
  Node exports, installed types, schema/migrations, production build, actual
  installed offline evaluation/review/comparison, extension builds, runtime
  module probes, operations and disabled-by-default Agent foundation. The final
  Health-only App source delta was repacked and reinstalled, its installed bytes
  matched the producer, and consumer typecheck/production build passed again.

The 151-target fake-inference journey performs sixteen real persisted calls and
checks replay, exact proof and no content mutation. Additional journeys cover
partial budgets, mixed/uncertain judgments, declaration drift, fresh-executor
continuation, exact same-segment retry, ambiguous dispatch and proof retention
after ordinary response diagnostic expiry. Complete current-source reprojection
is deliberate: the 151-target persistence test takes about a minute locally;
large production budgets and latency are not established by this fixture.

Production activation, operating qualification and measured model usefulness
remain unestablished. Actual model/provider Runtime trials remain excluded.
