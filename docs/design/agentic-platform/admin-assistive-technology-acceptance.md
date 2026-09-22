# Admin assistive-technology acceptance

Current requirements reconciled at PR #1478 squash `7603200b` on 2026-09-22 KST.
The environment investigation below retains its PR #1460 baseline and date
(2026-09-20 KST).
[State/accessibility](admin-state-accessibility.md) is the current presentation
record; [error recovery](admin-error-recovery.md) owns recovery behavior. Older
paragraphs in [Admin acceptance](admin-acceptance.md) describe historical gaps,
not new failures reproduced during this assessment.

**Actual screen-reader workflow acceptance remains not verified.** This record
provides a consolidated execution checklist and identifies missing evidence. It
does not turn automated keyboard checks into speech results or close full Admin/R5.

The later [success-lifecycle bundle](admin-success-lifecycle.md) supplies the three
synthetic success paths and local observation checkpoints identified below. The
preparation gaps in this original investigation are historical; actual AT output
remains unverified until separately observed.

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
A readable caption sequence could support a future observation; none was obtained
here. Audio quality, interruption and timing still require listening or equivalent
captured evidence. Repeatedly launching the same inaccessible panel would not
supply that evidence. The outstanding input is one consolidated run by an operator
who can hear VoiceOver or capture its actual output, using the scenarios below.

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

Current result for AT-01 through AT-06: **not verified**. Successful backend
integration paths and the now-shipped success fixtures do not substitute for
observed screen-reader presentation. The earlier success-fixture gaps are closed;
interactive preparation and actual utterance/focus records remain required. Do not add redundant automated tests just to rename this checklist.

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
