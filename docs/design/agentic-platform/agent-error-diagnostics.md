# Agent Studio error diagnostics and recovery

Implementation follows worker evidence PR #1466 (`e9087163`) and closes the
support-reference/recovery-declaration portion of [Admin Studio §13](admin-agent-studio.md#13-loading-empty-error-and-stale-states).
It does not change authority, execution, schema, versions, changesets or lockfile.

## Contract and ownership

Core `api-contract/error-diagnostics.ts` owns an optional, separately versioned
`x-np-error-diagnostics` transport header. Its exact JSON fields are `version: 1`,
`status`, `code`, canonical UUID v4 `supportReference` and an enumerated `recovery`.
Parsing is bounded to 512 characters and binds both status and code to the validated
error body. Unknown versions, extra fields, invalid references and inconsistent
recovery declarations fail closed to unavailable. The shipped exact `{ error,
status }` body, Next response serializer, and global OpenAPI schemas are unchanged.
The currently documented machine Gateway operations do not acquire Studio headers.

App `lib/agents/studio-error-response.ts` reuses the existing normalizer and Next
error serializer. It generates a fresh server reference and submits one structured
logger event containing only reference, status, stable code and read/mutation kind.
It does not read client correlation headers, resource identifiers, credentials,
request payloads, provider messages or exception text into this new event.
Existing opaque-error logging/reporting remains owned by the Next serializer.
Existing no-store directives are preserved; absent/cacheable directives become
private/no-store. Existing cookies and Retry-After survive.

The logger facade does not acknowledge durable delivery. A reference identifies
the submitted event, not a guaranteed retained record. Host logging configuration
and retention determine support lookup availability. No database table, background
worker, telemetry credential or automatic service activation is introduced.

## Recovery declarations

| Condition                                                     | Declaration      | Operator meaning                                                               |
| ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| 401 or existing recent-reauthentication 403                   | `reauthenticate` | Restore staff authentication before reloading.                                 |
| 409                                                           | `reconcile`      | Reload facts and reconcile; stale approval/CAS evidence stays invalid.         |
| Mutation 5xx                                                  | `check-outcome`  | Inspect current activity; a failed response does not prove no effect occurred. |
| Explicitly classified read, 429/502/503/504                   | `retry-read`     | An explicit read retry is eligible, subject to Retry-After.                    |
| Other failures, including ordinary forbidden and mutation 429 | `none`           | No retry eligibility is declared.                                              |

Classification comes from each owning operation, not the request method or a client
claim. Preview preparation and state-changing operations remain mutations even
when their surrounding endpoint also offers reads. Early opaque preview/artifact
responses, proxy failures, malformed success responses and transport failures may
have no metadata; the UI states that support/recovery information is unavailable.

Admin parses metadata only after validating the existing body and HTTP status.
Shared recovery rendering displays the safe stable code, support reference and
fixed declaration-specific guidance. Manual controls that reload current facts
are named as such; they do not assert that repeating a mutation is safe.
Declared read retries are explicit. A Retry-After deadline only controls waiting,
never dispatches a request or creates authority. Authentication loss clears sensitive
state; conflicts invalidate review facts; unchanged unknown-outcome mutations keep
the existing idempotency identity. No automatic mutation retry is added.

## Self-review and verification

Review corrected uncertain-approval copy that would have encouraged closing a
dialog and losing its request identity. New approval/principal actions now clear
previous diagnostic state. Browser verification also exposed a queued polling
revision that could restore cleared ChangeSet evidence after a conflict. A
synchronous path-specific invalidation marker now blocks both pending read effects
and background refresh requests until explicit refresh; invalidated views do not
claim they are still refreshing. Existing authentication and unknown-outcome rules
remain unchanged.

- Final `pnpm verify --concurrency=2`: 113/113 tasks; Core 2,122, Admin 166 and
  App 585 unit cases. Final `pnpm lint`: 41/41 tasks. Reviewed build: 41/41.
- Focused contract/envelope 13, Admin parsing/rendering 23 and App diagnostic/
  factory cases 85 passed before the final gates included those suites.
- Real PostgreSQL: 6 files / 50 cases, including the enabled native browser
  preview case. Activity admission metadata, current-site authority, connection,
  Gateway, approval and preview access paths passed.
- Initial production browser run: 84/87. Two expectations still used the old
  wait text; the third exposed the polling race above. Text corrections passed
  targeted rechecks. After the polling fix, the final complete production run
  passed **87/87 with retries disabled**, including bundled theme journeys.
  Three 320px captures were inspected: approval uncertainty, rate limiting and
  session loss. References wrap and existing recovery controls remain readable.
- Packed Core/Admin/App validation uses a fresh scaffold and 37 unchanged baseline
  artifacts. An intermediate consumer build hit ENOSPC; deleting only obsolete
  task-owned output and old task-generated cache entries resolved it. Final
  validation refreshed all three changed packages after the last source fix:
  Core 436 / Admin 10 / App 203 installed dist files match the final packed bytes.
  The same fresh scaffold was relinked and reinstalled, then passed typecheck,
  production build and the operational journey (all eight final refresh stages).
  This is not a new full 40-package acceptance run.
- Redis integration gates were not rerun: this bundle changes no Redis behavior.
  The default Redis unit task reports its three opt-in cases skipped. No new
  full Core PostgreSQL or full R5/40-package acceptance is claimed.

Logs are `/tmp/np-diagnostics-verify-final.log`,
`/tmp/np-diagnostics-lint-reviewed.log`, `/tmp/np-diagnostics-pg.log`,
`/tmp/np-diagnostics-browser-final.log` and
`/tmp/np-diagnostics-scaffold-final/summary-reviewed.json`.

Browser fixtures use synthetic references; route tests own the actual emitted-log
correlation assertion. Automated browser evidence does not replace the
[spoken assistive-technology checklist](admin-assistive-technology-acceptance.md).
Full R5 acceptance remains open, including unsupported server freshness/incident
states. Completed retention/manual-input work is not reopened.
