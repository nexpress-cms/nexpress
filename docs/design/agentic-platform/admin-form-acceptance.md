# Agent and policy form acceptance

This bundle covers the existing configuration and policy create/edit form owners,
within [Admin acceptance §20](admin-agent-studio.md#20-admin-release-acceptance).
It does not close exhaustive state coverage, long-localized-copy/high-volume
coverage, real spoken assistive-technology acceptance or full R5.

## Behavior corrected

- Comma-separated recipe/resource lists now update their canonical value while
  retaining the operator's raw text. Enter submission includes the latest list.
  Revisiting an unchanged list, or adding semantically irrelevant separators,
  does not rotate the unchanged request's idempotency key. Event-trigger lists
  retain their existing blur-time conversion, so partial numeric text is not
  coerced while typing; recreated arrays with equal contents retain raw text.
- Both editors focus their save-error notice. Native required/range validation
  continues to focus invalid fields before sending a request. Draft inputs remain
  mounted after recoverable failures; conflict still prevents stale resubmission.
- Resource inheritance controls name their resource and list hints are associated
  with the input. Form/field sizing allows narrow layouts and long identifiers to
  wrap without forcing the controls outside the viewport.

These changes remain in Admin shared owners. No route, contract, authority,
CAS, provider, activation or retention behavior changes. Acknowledgements still
lead to existing detail/readback flows; a draft save never activates an Agent.

## Browser evidence

Existing `agent-runtime.spec.ts` creation journeys were extended rather than
copied. Agent creation uses Tab, typing, Space and Enter for fields, scope,
capability mode and explicit delegation; an empty required name sends no request.
A failed save retains human input and focuses the error. Changing delegation
creates a new request identity.

Policy creation types a collections allowlist and submits with Enter before
blur. The payload includes that list. After a failed save, visiting the unchanged
list and retrying preserves the exact serialized request, including its key and
hash. Untrusted guidance remains text. One edit-specific journey verifies PATCH
with the read version/hash, then retained unsaved guidance and blocked resubmission
on a 409 conflict.

Each creation form samples 320px light, 768px dark and 1280px light with reduced
motion. Geometry checks cover horizontal document overflow and form controls;
screenshots preserve each sample. These samples do not claim every combination
of route, state, theme or motion preference. Earlier list, manual-run and success
lifecycle evidence remains in its own acceptance records.

## Verification

- Final dependency-complete build passed all 41 tasks. `pnpm verify` passed
  113 tasks (104 cached); `pnpm lint` passed 41 (40 cached). The unchanged Redis
  opt-in unit group reported 13 passed / 3 skipped.
- Production browser full run: 85/88 passed without retries. Three newly extended
  cases had test assumptions corrected: waiting for Radix option focus before
  typeahead; using ArrowRight to collapse selected text on macOS instead of End;
  expecting the existing human-readable conflict recovery rather than raw 409.
  Their focused rerun passed 3/3 without retries. Together these runs exercise all
  88 cases; this is not a claim that the first full run was green. Trigger numeric
  conversion, existing theme journeys and manual input passed in the full run.
- Six creation-form captures (three sizes per owner) were visually inspected;
  final corrected runs retain captures under `/tmp/np-form-browser-corrected`.
- Forty fresh local package tarballs supplied an isolated generated consumer.
  Installation, typecheck, production build and the existing scaffold operational
  journey passed. All ten Admin dist files match the tarball and installed
  consumer byte-for-byte. This targeted consumer check does not rerun the full
  extension/migration scaffold matrix.
- Scoped formatting, local link targets and `git diff --check` passed. The E2E
  file is intentionally ignored by repository ESLint configuration; its direct
  lint invocation reported that exclusion, not a lint pass. Logs: `/tmp/np-form-{verify-final,lint,browser,browser-corrected,scaffold}.log`.

Review of the shared input owner found that trigger consumers recreate/coerce
arrays. The final implementation preserves equal-content raw text and their
previous blur-time numeric conversion. The existing activation journey now
exercises partial scientific notation and the final numeric payload.
PostgreSQL/Redis/native-preview integration contracts are unchanged; this bundle
must not be described as a fresh full R5 integration gate.
