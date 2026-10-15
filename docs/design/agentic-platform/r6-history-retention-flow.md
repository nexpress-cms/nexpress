# R6 reference-safe history retention

R6 pruning is an explicit host option on the existing Runtime maintenance owner.
Without an `incidentRetention` policy, existing hosts retain the previous behavior.
The pure [policy parser](../../../packages/core/src/agent-contract/incident-retention-contract.ts)
accepts `signalDays` from 1 to 90 and `historyDays` from 1 to 365. The conservative
installation is `{ signalDays: 90, historyDays: 365 }`. Ages are eligibility floors,
not permission to remove dependencies or evidence of unresolved effects.

| Record                     | Eligibility                                                                                                      | Required preservation                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orphan Signal              | Suppressed/resolved, expired, and creation/update/window all older than `signalDays`                             | Open Signals, invalid canonical digests and any retained references stay.                                                                                                                   |
| Closed Incident cohort     | Resolved/dismissed, closure/update/observation older than `historyDays`; every member independently eligible     | All foreign Agent references, immutable normal audit, approvals, rollback and recovery evidence pin the complete cohort.                                                                    |
| Timeline and feedback      | Old enough, selected with their whole closed Incident cohort                                                     | Action/verification/model assessment, audit/Run/provider/approval links and external supersession references stay.                                                                          |
| Local admin notification   | Old confirmed-local canonical delivery; closed/aged Incident; no active/unknown containment or foreign reference | External delivery, retry/unknown outcomes and required references stay. Eligible local feed rows can expire independently of an audited Incident.                                           |
| Restored containment       | Old restoration with exact Action back-links                                                                     | Those required Actions and their audit/approval/restoration evidence currently pin real containments. There is no invented release receipt or automatic removal.                            |
| Moderator flood checkpoint | Complete window older than `signalDays`, through the source-owned cleanup owner                                  | Partial/active collection stays. Old completed metadata becomes an expired tombstone before derivative rows are removed. Original Events and Signals retain their independent dependencies. |

The [Incident retention helper](../../../packages/core/src/agent/incident-retention.ts)
uses the existing unified UUID cursor. A call examines at most 25 supplied or
selected roots; the maintenance owner supplies the remaining row budget. A whole
cohort must fit within that budget, the 10,000-row ceiling and the 16 MiB body
ceiling. An oversized, invalid or pinned cohort is retained and does not stop the
cursor from advancing. Child sets, normalized Incident/Signal edges and the root
are deleted in the same transaction, including internal feedback supersession
links. There is no partial cohort deletion.

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
