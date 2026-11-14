# Admin assistive-technology acceptance

Current requirements reconciled at PR #1478 squash `7603200b` on 2026-09-22 KST.
The environment investigation below retains its PR #1460 baseline and date
(2026-09-20 KST).
[State/accessibility](admin-state-accessibility.md) is the current presentation
record; [error recovery](admin-error-recovery.md) owns recovery behavior. Older
paragraphs in [Admin acceptance](admin-acceptance.md) describe historical gaps,
not new failures reproduced during this assessment.

The [November VoiceOver run](#voiceover-observation--2026-11-14-kst) captured
actual captions from all six workflows. The [follow-up](#voiceover-follow-up--2026-11-14-kst)
records the fixes and retest. The [supplemental checks](#remaining-voiceover-checks--2026-11-14-kst)
record the later captions. The [grouped local acceptance](#grouped-local-acceptance--2026-11-14-kst)
records automatic loading speech and the Incident response review.

The [success-lifecycle bundle](admin-success-lifecycle.md) supplies the three
synthetic success paths and local observation checkpoints identified below.

<a id="environment-investigation"></a>

## Historical environment investigation — PR #1460

| Observation                        | Result                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                           | `bf348d9c5b27affd79b84fee0a6c84d4853334e2`                                                                                                                                                                                                                                       |
| Host                               | macOS 26.3, build 25D125                                                                                                                                                                                                                                                         |
| Installed VoiceOver bundle version | 10 (bundle metadata; not a separately tested engine version)                                                                                                                                                                                                                     |
| Installed Google Chrome            | 153.0.8010.50 (not the Playwright Chromium version)                                                                                                                                                                                                                              |
| Actual AT application access       | Two native VoiceOver application queries timed out. System Settings subsequently confirmed VoiceOver on.                                                                                                                                                                         |
| Caption observation                | VoiceOver Utility showed caption panel enabled. Native Chrome screenshot/AX results did not expose caption text; no actual spoken output was captured.                                                                                                                           |
| Automation setting                 | VoiceOver Utility showed AppleScript control disabled; it was not enabled. No new OS permissions were granted.                                                                                                                                                                   |
| Cleanup                            | VoiceOver was switched off through System Settings and the off state was observed; its process was then absent. Temporary utility/settings windows and the blank test tab were closed. Caption shortcut was toggled twice; no persistent caption preference change was intended. |
| Product workflows                  | Not executed with verified AT output in this investigation. No connection, Agent, approval, rollback or credential action was performed.                                                                                                                                         |

The native app/AX capability can inspect controls and send keys, but those results
are not the screen reader's utterances. Apple documents that the
[caption panel displays what VoiceOver is speaking](https://support.apple.com/en-kw/guide/voiceover/unac078/mac).
This investigation obtained no readable caption sequence. Audio quality,
interruption and timing still require listening or equivalent captured evidence.

See [Agent diagnostic presentation](admin-agent-diagnostics.md) for the follow-up
Health/Doctor display and its explicit limits. Subsequent
[maintenance](agent-maintenance-evidence.md), [budget](agent-budget-evidence.md)
and [worker](agent-worker-evidence.md) owners supply bounded observations. They
do not establish end-to-end job progress, overall readiness or actual AT acceptance.

## Requirement reconciliation

| Requirement                                                                                     | Existing evidence and scope                                                                                                                                                                                                                                                    | Remaining work / verdict                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial loading, retained read-only refresh, empty and partial failure (§13; §20.3)             | PR #1460 static skeletons, persistent titles, receipt times and independent Run-action/OAuth recovery; Activity, queue and policy fixtures.                                                                                                                                    | Browser evidence passed at that baseline. Actual loading/refresh announcements are not verified.                                                                                                                                         |
| Authorizing review refresh (§13)                                                                | Explicit refresh clears authorizing facts; background polling retains mounted review and retry identity until validation.                                                                                                                                                      | Verify announcements explain this distinction and polling does not make reading unusable.                                                                                                                                                |
| Authentication, permission, rate limit and malformed response (§13)                             | PR #1459/1460 login link, rejected-evidence clearing, stopped polling, valid Retry-After and safe validated errors.                                                                                                                                                            | Actual error announcement and keyboard recovery with AT are not verified.                                                                                                                                                                |
| Conflict and unsent human text (§13)                                                            | Owner-specific CAS and unchanged-request fixtures cover particular forms.                                                                                                                                                                                                      | No blanket pass for preserving every form's text. Observe each scenario's submitted/unsent text and require fresh review where authority changed.                                                                                        |
| Read timing, support correlation and recovery (§13)                                             | [Read observation](studio-read-observation.md) separates browser receipt and existing Runtime projection generation; [error diagnostics](agent-error-diagnostics.md) supplies optional validated support references and recovery declarations without changing the error body. | Cache age and underlying-source freshness remain unavailable. Missing diagnostics stay unavailable; a support reference does not guarantee retained logs. Actual announcements remain unverified.                                        |
| Responsive/theme/reduced-motion/long-copy/volume (§20.7)                                        | PR #1460 inspected the named surfaces and bounded fixtures at 320/768/1280 in both themes.                                                                                                                                                                                     | Preserve the recorded inspection boundary; not every row/state was manually inspected.                                                                                                                                                   |
| Validated responses, authorization, secret handling, sealed authority and audit (§20.1/2/4/5/9) | Existing browser and server evidence in the linked acceptance records.                                                                                                                                                                                                         | Not rerun or broadened by this documentation assessment; speech checks do not replace backend evidence.                                                                                                                                  |
| Health/Doctor (§20.10)                                                                          | [Diagnostic presentation](admin-agent-diagnostics.md), [maintenance receipts](agent-maintenance-evidence.md), [budget measurements](agent-budget-evidence.md) and [worker subscription evidence](agent-worker-evidence.md) now have bounded server and presentation evidence.  | Registration, committed batches, completed sweeps, measured usage and subscribed workers are separate observations. Samples do not prove every queue is covered, end-to-end progress or overall readiness; actual AT remains unverified. |
| Keyboard plus screen reader (§20.6)                                                             | Existing keyboard/focus/name checks pass; no verified AT utterance record.                                                                                                                                                                                                     | All six scenarios below remain not verified for actual AT.                                                                                                                                                                               |
| Polling, shared owners and shipped documentation (§20.8/11/12)                                  | Existing bounded polling tests and shared Admin/app owners, with flow evidence.                                                                                                                                                                                                | Preserve these contracts in any later defect fix; no new product behavior here.                                                                                                                                                          |
| Incident response                                                                               | No incident route is shipped in the inventory.                                                                                                                                                                                                                                 | Applies to its future phase. Do not create a fictional fixture to close R5.                                                                                                                                                              |

No design requirement is removed by this table. Contract work, if selected later,
needs its own defined owner and scope. Completed retention and executor-owned
manual input are not reopened.

## One consolidated run

Use an isolated local test database and the existing E2E setup described in
[testing guidance](../../testing.md). The fixture sources below use real Admin UI
with synthetic API responses; ordinary navigation in a normal browser does not
install their request mocks. Do not run these steps on a production host or
replace mocked activation/credential writes with live operations.

Prepare the selected fixture in a headed interactive session. A developer must
retain its existing `page.route` handlers, login/rate-limit isolation and parsers,
then pause before automated interaction. Step or hold each response while the
operator performs the keyboard/VoiceOver action. Debugging an existing Playwright
test is a setup aid, not an AT pass. The shipped
[success-lifecycle checkpoints](admin-success-lifecycle.md#reproducible-observation-checkpoints)
supply successful activation, revocation and rollback sequences. Their paused
observations complement the free-form keyboard/AT failure and recovery scenarios;
they do not themselves complete this checklist.

Disable fixture dialog auto-accept handlers for connection/token revocation during
this interactive adaptation: the operator must hear and confirm or cancel the
native dialog. Keep subsequent application responses synthetic. For 429 cases,
hold the test clock until the wait notice and disabled action have been observed;
only then advance it to inspect expiry and explicit retry. Preserve the original
automated tests unchanged unless a reproduced defect justifies a regression edit.

For each run, record:

- Commit, OS, actual browser and AT versions, language, VO modifier and verbosity.
- Fixture/test name, route, synthetic response sequence and any fixture changes.
- Starting focus, keyboard/VO sequence, expected message and actual utterance or
  caption text. Record interruptions/repetition, not just the final visible label.
- Ending focus, rendered outcome, artifact location and pass/fail/not verified.
- A reproduced defect and affected owner, or the precise reason a step could not
  be observed. Never fill actual utterances from DOM text or expected copy.

Navigate headings and controls with the configured VO modifier and keyboard;
use Tab/Shift-Tab, Enter/Space and Escape where the workflow calls for them.
Do not force DOM focus to manufacture a successful traversal. Announcements may
vary by AT settings; assess name, role, state, consequences and usable reading
order rather than requiring a particular punctuation string.

| ID / workflow           | Steps and expected observable behavior                                                                                                                                                                                                                                                                                                                                                       | Existing fixtures / interactive preparation                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 Connection        | Open create; read loading/availability and labels. Enter synthetic values by keyboard. Submit 503, then 429: hear safe failure/wait, retained non-secret name and cleared credential. Explicit retry reaches returned detail. Exercise invalid detail, 403 and 401; rejected facts disappear and Sign in is reachable. Complete successful revocation separately and confirm returned state. | [Connection fixtures](../../../apps/web/tests/e2e/agent-connections.spec.ts): `connection keyboard creation preserves retry identity and clears invalid or inaccessible detail` plus `connection successful revocation waits for confirmed server state and stays terminal`. The success case has local observation checkpoints; retain the failure/recovery sequence separately. |
| AT-02 Activation        | Open Agent detail; read readiness and effective configuration before activation becomes available. Review exact version; open activation and manual trigger controls. Hear checkbox state and confirmation consequences. Exercise 409, re-review and access loss. Separately complete a synthetic successful activation and read the returned active state without a provider call.          | [Runtime fixtures](../../../apps/web/tests/e2e/agent-runtime.spec.ts): `Runtime Agent filtering and activation keep the reviewed version and trigger plan` plus `Runtime activation waits for acknowledgement and readback before showing active controls`. The latter supplies held acknowledgement/readback and local checkpoints.                                              |
| AT-03 Approval          | Read sealed facts and non-authorizing proposal text. Explicit refresh announces temporary invalidation. Open Approve; hear dialog heading and challenge description; enter challenge/reason. Hear one useful uncertain-outcome error, retry unchanged, and hear approved as a decision rather than execution. Cancel/Escape returns focus. Exercise stale challenge and access loss.         | [Approval fixtures](../../../apps/web/tests/e2e/agent-approvals.spec.ts), `requires a typed challenge and renders only the returned decision state` and `clears a stale challenge, reloads facts, and removes evidence after access loss`.                                                                                                                                        |
| AT-04 Rollback          | Read plan facts, operation classification and Before/After without relying on color. Exercise prepare, request approval, execute and cancel. Hear uncertain outcome then conflict; stale facts cannot authorize another action. Separately complete a synthetic prepare → approved plan → execution sequence and read its returned outcome; do not optimistically announce restored content. | [ChangeSet fixtures](../../../apps/web/tests/e2e/agent-changesets.spec.ts): `rollback {action} uses exact current bindings and removes stale evidence` plus `rollback succeeds through preparation, human approval and verified compensation`. The success fixture includes actual approval UI navigation and local checkpoints; server outcomes remain synthetic.                |
| AT-05 Gateway principal | Open Suspend; hear title; Escape returns to invoker. Reopen, enter reason, submit failure and unchanged retry. Read returned suspended → active → revoked states. Verify meaningful focus when the initiating control disappears and after malformed detail recovery.                                                                                                                        | [Gateway fixtures](../../../apps/web/tests/e2e/agents.spec.ts), `uses a reviewed reason and fresh versions for principal suspension, resumption, and revocation`.                                                                                                                                                                                                                 |
| AT-06 Service token     | Issue a synthetic token with initial failure and explicit retry. Read one-time disclosure instructions and labeled controls. Copy receives acknowledgement; “I saved it” removes the value and restores Create token focus. Refresh cannot redisclose it. Revoke failure/retry then returned revocation; 401 clears metadata/value and exposes Sign in.                                      | [Token fixtures](../../../apps/web/tests/e2e/agent-connections.spec.ts), `Gateway token keyboard issue, one-time disclosure and revocation preserve recovery identity`. Never capture an operational token in AT artifacts.                                                                                                                                                       |

## VoiceOver observation — 2026-11-14 KST

Baseline `5592861a`, macOS 26.3, VoiceOver bundle version 10 and headed Chrome
for Testing 151.0.7922.34. The caption panel used the host's Korean interface
and existing verbosity settings. The test first captured **Read back alpha
seven, 버튼** and **Read back beta nine, 버튼** on successive Tab presses.

The six workflows ran together through 13 existing browser cases against an
isolated PostgreSQL database and synthetic API responses. All 13 passed with
retries disabled. Temporary copies held selected states for observation and
logged keyboard focus alongside sampled images of the actual caption window.
Native confirmation dialogs stayed open briefly before the fixtures supplied
their existing response. The run sampled captions and focus around state
changes. Audio and complete reading order remain unverified.

| Workflow                | Observed with VoiceOver                                                                                                                                                                                | Still to verify                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| AT-01 Connection        | VoiceOver identified Name and read the write-only API key field as a secure text field. It read the failed request, invalid detail, access-loss and sign-in alerts and the native revoke confirmation. | Loading and rate-limit wait announcements, and reading the returned revoked state.                               |
| AT-02 Activation        | VoiceOver read **Review effective configuration** and **Enable after activation, 선택됨, 체크박스**. After the active readback, keyboard focus was on the document body.                               | Reading the reviewed version and consequences, conflict and access-loss recovery, and the returned active state. |
| AT-03 Approval          | VoiceOver read the Approve dialog heading, challenge field and uncertain decision message. Escape returned focus to Reject in the stale-challenge case. The later access-loss alert was captured.      | Temporary refresh invalidation, stale-challenge recovery and confirmation of the returned approved state.        |
| AT-04 Rollback          | VoiceOver read Request rollback approval, Execute approved rollback and the warning that the rollback request could not be confirmed. After verified readback, focus was on the document body.         | Plan facts and Before/After reading order, conflict and cancel recovery, and the returned verified state.        |
| AT-05 Gateway principal | VoiceOver read the Suspend dialog and the failure alert. Escape returned focus to Suspend principal. VoiceOver also read the malformed detail alert.                                                   | Reading the status after suspend, resume and revoke and following focus through detail recovery.                 |
| AT-06 Service token     | VoiceOver read the token-issue failure and native revoke confirmation. The fixture confirmed that acknowledging storage cleared disclosure and restored focus to Create token.                         | VoiceOver reading of disclosure instructions, copy acknowledgement, final revocation and session recovery.       |

This table records the first run. The local capture files and timestamped
focus records for both runs are under `/tmp/nexpress-at-caption.goH5MW` on the
test Mac.

## VoiceOver follow-up — 2026-11-14 KST

The follow-up used the same macOS, VoiceOver and headed Chrome environment,
with synthetic responses and the isolated PostgreSQL fixture database. The
test copies held key states and sampled the caption window. Keyboard focus was
recorded from the active element alongside the captions.

Focus returned to the document body after activation and verified rollback
on the baseline. The fixed views focus the validated readback when the
invoking control disappears and the user has not moved elsewhere. Approval
refresh retains its focused control during invalidation, and decision
readback or stale-challenge recovery returns to the approval facts as needed.
Connection creation gives rate-limit wait guidance. Connection revocation
focuses its returned status. Gateway mutations focus the returned principal
or token status, and one-time token disclosure exposes its instructions and
announces successful copy. A rollback conflict now tells the operator to
refresh and review the current plan. An uncertain response retains the separate
guidance to confirm the outcome before continuing.

The production-build browser run passed all 13 cases without retries. The
table distinguishes captured VoiceOver output from steps still requiring
screen-reader observation. The run used keyboard fixture interactions, with
native confirmation responses supplied by the fixtures after a short hold.
A temporary Chrome profile disabled translation suggestions for supplemental
checks. Chrome toolbar focus still interrupted some caption capture.

| Workflow                | Captured VoiceOver evidence                                                                                                                                                                                                                     | Still to verify with VoiceOver                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| AT-01 Connection        | Write-only secure field, submission and access-loss alerts, 429 wait instructions, native confirmation, and **Connection revoked**.                                                                                                             | Initial loading and adapter availability announcements.                                                                     |
| AT-02 Activation        | Effective configuration review heading, checked trigger control, and **active · operator · version 2 (active)**. Browser focus reached the changed-resource and access-loss alerts.                                                             | Exact pre-activation version and consequences, and the spoken conflict and access-loss recovery.                            |
| AT-03 Approval          | Approval dialog and typed challenge, uncertain response, **Server approval facts pending · Risk: reversible** after stale challenge, access loss, and **Server approval facts approved · Risk: reversible** after decision readback.            | Explicit refresh invalidation announcement and reading the sealed facts and decision-versus-execution explanation in order. |
| AT-04 Rollback          | **Compensation plan · ready**, request approval, execute and cancel controls, separate uncertain-outcome and conflict alerts, and **Compensation plan · verified** after readback.                                                              | Complete Before/After reading order.                                                                                        |
| AT-05 Gateway principal | Suspend dialog and Escape return, failed change, **Gateway principal suspended**, **active**, **revoked**, and malformed-detail recovery alert.                                                                                                 | The caption and focus checkpoints cover the requested transitions.                                                          |
| AT-06 Service token     | One-time disclosure instructions, **Token copied to clipboard**, return to Create token, and the named token's **revoked** state. Browser assertions confirmed disappearance of the token, lack of redisclosure and the Sign in link after 401. | Spoken session-recovery guidance in the token detail flow.                                                                  |

For the primary follow-up, `voiceover-final.log` records the 13 browser
results; `final-marks.jsonl` and `final-captions/` hold their checkpoints
and captured output plus the supplemental passes. Workspace `verify` passed
113 tasks and `lint` passed 41. After the conflict message changed, Admin build,
typecheck and lint, the reference production build, and the five rollback
cases in `voiceover-rollback-final.log` passed again. The first concurrent
verification run timed
out in six App cases. The serial rerun passed all 931 App cases without a
timeout change. The local sandbox and synthetic responses exercise user-facing
behavior. Full operator-led AT and R5 acceptance remain open.

## Remaining VoiceOver checks — 2026-11-14 KST

The supplemental run exercised the production build from commit `fbce0500`,
with the same VoiceOver caption window, a temporary Chrome profile and local
synthetic responses. Native keyboard input and Chrome caret browsing were used
for selected static text. Captions from these steps establish what was read
at the selected locations.

| Workflow            | Additional caption evidence                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 Connection    | **Installed adapter**, **acceptance-provider v1** and the selected item in the native menu.                                                                                                                    |
| AT-02 Activation    | Effective configuration **version 2**, the server authority/version/dependency recheck sentence, the changed-resource instruction to reload and review the current version, and the Runtime access-loss alert. |
| AT-03 Approval      | The refresh notice that review facts and authorizing controls are unavailable until validation completes. Caret browsing captured the statement-hash label and **Approval records a human decision**.          |
| AT-04 Rollback      | With a forward caret selection, VoiceOver first read **Before: "Applied title"** and then **After: "Original title"**.                                                                                         |
| AT-06 Service token | **Your session is no longer available. Sign in again to load current information.** The **Sign in** link was reachable and read by VoiceOver.                                                                  |

The original bundle covers AT-05. Each supplemental browser fixture passed
within the combined run or its focused replay. The temporary connection
fixture initially expired its absolute retry deadline during the extended
loading hold. Using a 60-second relative response deadline let the same
product behavior pass with the hold intact.

The final pass used the same production build on the merged tree `47b06834`
with the existing synthetic fixtures. The operator used Chrome caret browsing
to read text that had previously been visible only in the accessibility tree.

| Workflow         | Captured VoiceOver output and reading action                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 Connection | **Loading Agent Studio data…** while the initial adapter response was held and Save was disabled. The operator read the status by keyboard during the load.                                                                                                                                                                                                                                                                         |
| AT-02 Activation | Before submission, VoiceOver read the staff-primary reauthentication notice, the instruction to keep the same request key for an unknown outcome, the trigger registration and enablement guidance, and the replacement draft and fresh trigger identity requirement. Long text was read in sections.                                                                                                                               |
| AT-03 Approval   | From **Server approval facts**, forward keyboard reading visited state and risk, approval version and generation, target and operation, statement hash, capability and scopes, capability contract, policy binding, preview and reauthentication requirements, human requirements, requester and expiry. The next caption explained that approval records a human decision and execution has its own authority and evidence checks. |

The loading check verifies keyboard reading of the initial status. Automatic
speech on page entry was not captured. The approval sequence came from
consecutive forward caret selections on the same page, with long values
split across captions. The three browser scenarios passed without retries.
Local evidence is under `/tmp/nexpress-at-caption.goH5MW` in
`closing-captions/`, `closing-approval-early.tsv` and `voiceover-closing.log`.
The [merge CI](https://github.com/nexpress-cms/nexpress/actions/runs/43588705384)
and [Release workflow](https://github.com/nexpress-cms/nexpress/actions/runs/43588705385)
succeeded. Full Playwright ran successfully on the
[PR](https://github.com/nexpress-cms/nexpress/actions/runs/43586931149) and was
skipped by the push workflow.

## Grouped local acceptance — 2026-11-14 KST

The run used baseline `47f4b2aa`, an isolated PostgreSQL database, the reference
production build, Chrome for Testing 151.0.7922.34 and VoiceOver 10 on macOS
26.3. Responses for the Incident mutations and provider adapter were synthetic.

| Workflow                            | Observed result                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection entry                    | Keyboard activation of **Add connection** reached the create screen. Before the fix, two 7.8-second adapter delays displayed the loading message without a corresponding caption. After the fix, both delays produced **Loading Agent Studio data…** with no input after Enter. The immediate response settled without a loading caption and enabled the form.                        |
| Moderator                           | Keyboard execution used current approval and target bindings supplied by the fixture. VoiceOver read the unchanged-request retry guidance and the returned **Quarantine plan · succeeded** and **Restore plan · succeeded** headings. A conflict and a 403 removed the old plan and focused the appropriate alert, which VoiceOver read.                                              |
| Guardian                            | VoiceOver read the unchanged-request retry guidance, the 600-second plan and scope, approval pending, the verified network scope and shared-network impact in the approval review, and **Awaiting verification** followed by **succeeded** after explicit result checking. The fixture supplies the approved state.                                                                   |
| Admin states and responsive layouts | Production browser assertions covered loading, retained refresh, empty and populated views, rate limits, contract failures, conflicts and access loss. Visual inspection covered Incident response at 320/768/1280 px with reduced motion and light and dark examples, the 320 px retry wait and evaluation states, and long Korean labels and bounded lists in Policies and Runtime. |

The Studio loading status announces only after a short pending interval.
Incident response results and alerts recover focus when the invoking control
disappears. An unchanged retry preserves the existing request identity.
Browser assertions cover the focus of pending and terminal results and
conflict and access-loss alerts.

The four headed scenarios passed after the loading and focus changes. Three
Incident replays passed again after improving focus for uncertain outcomes.
The production browser regression passed all 38 cases without retries.
Workspace `verify` passed 113 tasks and `lint` passed 41.
The temporary files and raw artifacts are under
`/tmp/nexpress-at-caption.goH5MW`. The caption index is
`grouped-caption-evidence.tsv` and the browser logs are
`voiceover-grouped*.log` and `grouped-regression.log`.
The November VoiceOver run remains the source for the other workflows.
Exact-session revocation and other Incident controls have browser checks.
Their complete screen-reader journeys and host operating qualification remain
outside the evidence from this run.

## Result record template

```text
Scenario / baseline:
OS / browser / AT versions and settings:
Fixture source / response sequence / preparation changes:
Step / keys / starting focus:
Expected accessible outcome:
Actual utterance or caption / timing / interruptions:
Ending focus / returned state:
Artifact (synthetic data only):
Verdict: pass | fail | not verified
Defect or blocking evidence:
```

<a id="verification-of-this-bundle"></a>

## Historical verification — PR #1461 reconciliation

Documentation-only reconciliation and environment investigation. No application
code or fixture was changed, no product defect was reproduced, and no new browser,
DB, build or full R5 gate is claimed. PR #1460 exact-head CI `35503109565`, merge CI
`35503812632` and Release `35503812568` were observed successful. The linked record
retains the previous 83-browser-case and seven-stage packed-consumer evidence.

Final checks cover document formatting, relative paths/anchors, fixture-name
references and `git diff --check`. Actual AT acceptance stays open pending the
single consolidated run above. The user subsequently authorized commit, PR and squash merge after CI.
Publication remains outside this bundle.

## Current documentation reconciliation

The PR #1478 baseline supplies the current read-observation behavior. Its
[exact-head CI](https://github.com/nexpress-cms/nexpress/actions/runs/35694278882),
[merge CI](https://github.com/nexpress-cms/nexpress/actions/runs/35695613276) and
[Release workflow](https://github.com/nexpress-cms/nexpress/actions/runs/35695613252)
succeeded. These are recorded code gates, not a new local application test or
screen-reader run. This documentation update checks formatting, local links,
fixture names and whitespace; the historical environment investigation and its
results are preserved. Full R5 and AT-01–AT-06 remain open.
