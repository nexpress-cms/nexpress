# R6 reference-safe history retention

R6 pruning is an explicit host option on the existing Runtime maintenance owner.
Without an `incidentRetention` policy, existing hosts retain the previous behavior.
The pure [policy parser](../../../packages/core/src/agent-contract/incident-retention-contract.ts)
accepts `signalDays` from 1 to 90 and `historyDays` from 1 to 365. The conservative
installation is `{ signalDays: 90, historyDays: 365 }`. Ages are eligibility floors,
not permission to remove dependencies or evidence of unresolved effects.

| Record                      | Eligibility                                                                                                                                                                               | Required preservation                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orphan Signal               | Suppressed/resolved, expired, and creation/update/window all older than `signalDays`                                                                                                      | Open Signals, invalid canonical digests and any retained references stay.                                                                                                                   |
| Closed Incident cohort      | Resolved/dismissed, closure/update/observation older than `historyDays`; every member independently eligible                                                                              | All foreign Agent references, immutable normal audit, approvals, rollback and recovery evidence pin the complete cohort.                                                                    |
| Timeline and feedback       | Old enough, selected with their whole closed Incident cohort                                                                                                                              | Action/verification/model assessment, audit/Run/provider/approval links and external supersession references stay.                                                                          |
| Local admin notification    | Old confirmed-local canonical delivery; closed/aged Incident; no active/unknown containment or foreign reference                                                                          | Local-only receipts can expire independently of an audited Incident; externally routed receipts expire only with their complete terminal group.                                             |
| External notification group | Closed/aged Incident; local receipt, every frozen route and all routing/attempt facts older than `historyDays`; each external result canonically confirmed, proven not-sent or suppressed | Queued/sending, ambiguous, missing/corrupt proof, incomplete routing/attempt history, unresolved containment and any retained reference pin the whole group.                                |
| Restored containment        | Old restoration with exact Action back-links                                                                                                                                              | Those required Actions and their audit/approval/restoration evidence currently pin real containments. There is no invented release receipt or automatic removal.                            |
| Moderator flood checkpoint  | Complete window older than `signalDays`, through the source-owned cleanup owner                                                                                                           | Partial/active collection stays. Old completed metadata becomes an expired tombstone before derivative rows are removed. Original Events and Signals retain their independent dependencies. |

The [Incident retention helper](../../../packages/core/src/agent/incident-retention.ts)
uses the existing unified UUID cursor. A call examines at most 25 supplied or
selected roots; the maintenance owner supplies the remaining row budget. A whole
cohort must fit within that budget, the 10,000-row ceiling and the 16 MiB body
ceiling. An oversized, invalid or pinned cohort is retained and does not stop the
cursor from advancing. Child sets, normalized Incident/Signal edges and the root
are deleted in the same transaction, including internal feedback supersession
links. There is no partial cohort deletion.

External history is selected through its existing local Admin receipt root in the
same maintenance cursor. The group contains that receipt, all selected external
routes, the routing marker and every delivery-attempt timeline fact.
It can expire independently of an audited Incident skeleton only when no retained
record references a group member. Its routing marker becomes a small expired
tombstone keyed by the stable local transition deduplication key, without deleted
notification/destination/credential identifiers. That prevents explicit historical
local recording recovery from routing the same effect again after receipt expiry.
Compacting this marker counts once against the existing pruning row budget; the
tombstone remains with the Incident. A single active, ambiguous, recent or invalid
route preserves its siblings and source receipt. Frozen Connection/configuration,
audit, approval, rollback and source evidence are never deleted by this group.
Expiry checks reuse the delivery owner's canonical ledger validation without
resolving credentials, contacting a transport or requiring current send authority.
A prior ambiguous attempt remains unresolved unless the same downstream-idempotent
operation ultimately has a canonical confirmation; a later not-sent error alone
does not erase the earlier uncertainty.

Every deletion checks all Agent tables, the site deletion marker, same-site
`np_settings` JSON, immutable normal audit including global audit, and live
pg-boss payloads. The existing exclusive source-release fence precedes row locks;
an additional `np_settings` share lock prevents a concurrent private checkpoint
or generic settings reference from racing the scan. NOWAIT and the existing
statement budget fail closed rather than waiting through an inverted lock order.
The caller's transaction also owns the cursor and maintenance receipt, so a
timeout after a child deletion rolls all changes back.

The [flood cleanup owner](../../../packages/core/src/agent/moderator-flood-retention.ts)
uses a bounded private settings cursor and removes at most 100 derived rows per
selected checkpoint in a call. It only removes keys owned by the verified
window/settings/staff namespace. Unknown metadata stays. A stable expired
tombstone prevents a fresh collector from treating a partially retained historical
window as complete; exact existing Runtime Run replay keeps its separate retained
authority path. These small tombstones are an intentional retention tradeoff.

Real workflow closure normally creates audit that pins the Incident skeleton and
its required decision history. This implementation does not promise universal
erasure after 365 days. It provides actual cleanup of reference-free imported or
legacy closed cohorts, eligible local notification history, terminal orphan
Signals and completed flood bookkeeping, while preserving the owning evidence
lifecycles. It never changes normal audit or source-release records, starts a
worker/provider, executes a moderation capability, or performs a live-model
Runtime acceptance trial.

The [segmented Moderator extension](r6-moderator-automatic-segmented-flow.md)
retains V2 request diagnostics containing only bounded immutable source metadata
and digests. Every linked segment needs that proof for active continuation and
historical aggregate verification. It expires with its owning provider-call
reference lifecycle; ordinary response diagnostics still expire after their
normal deadline. A row containing only preserved proof is not repeatedly counted
as pruned diagnostic history. Automatic Action/Containment authorization and
compensation evidence remain protected by the existing required-effect/audit
reference rules.

## External notification retention verification

The 2026-10-16 follow-up extends the existing owner without adding a schema,
public operation, worker or transport installation. It reuses the sender's exact
canonical ledger validation and the existing source-release/reference fence,
cursor, age policy, row/body ceilings and transaction budget. Queued/sending,
missing or corrupt receipts, incomplete routing/attempt history, and unresolved
ambiguity preserve the complete notification group. Confirmed downstream
idempotent replay can resolve an earlier ambiguous attempt; a later not-sent
error cannot. A routing tombstone also blocks a recreated local receipt from
selecting destinations again.
The tombstone preserves the group's greatest timeline sequence. Attempt rows are
removed before moving it into that unique position, in the same transaction, so
later appenders cannot reuse a position already observed by a retained cursor.

Local validation:

- `pnpm verify --concurrency=2`: all 113 tasks passed, including 2,424 Core unit
  cases. `pnpm lint`: all 41 tasks passed. Core and test-inclusive TypeScript
  checks passed. The initial default-concurrency verify run ended with a native
  CLI template compiler `Bus error` (exit 138); the same CLI typecheck passed
  alone, and the complete bounded-concurrency retry passed. No test assertion,
  timeout, compiler or heap setting was relaxed.
- A final self-review correction preserves that timeline sequence when the tail
  expires. After this correction, Core build/typecheck, all 2,424 Core unit cases,
  test-inclusive TypeScript, lint and all 49 affected PostgreSQL cases were
  repeated successfully. The rollback case fails after attempt deletion and
  before the tombstone moves, proving that both changes roll back together.
- The final real PostgreSQL run passed all 49 cases in the five affected
  delivery, notification retention, Incident retention, site deletion and Runtime
  retention files without skips. The ten new cases cover terminal group expiry,
  all-route preservation, ambiguous retries, exact source/result/history proof,
  audit/settings references, site isolation, remaining budget, rollback after
  child deletion, and historical local-recording replay after expiry.
- All 40 public packages passed the full 52-stage installed-consumer journey,
  including the extension matrix and operations checks. After the sequence
  correction, the final Core tarball and the identical other 39 tarballs passed
  ten affected stages in another clean scaffold: installation/imports,
  configuration-inclusive typecheck, schema generation, production build, fresh
  database migration and disabled Agent foundation checks. Every installed Core
  JavaScript and declaration file matched the final producer bytes. The separate
  clean scaffold avoids the mock theme workspace dependency intentionally left
  by the earlier extension matrix fixture.

Only fake transports were used; no paid API, actual external delivery or model
Runtime trial was invoked. Dedicated Redis, theme, native preview and production
browser journeys were not repeated for this Core history-only follow-up. This is
affected-slice evidence, not a new full R6 acceptance claim. Versions, changesets,
lockfile and application schema/migrations remain unchanged. The pre-existing
handoff is preserved. Logs use `/tmp/np-notification-retention-*`.
