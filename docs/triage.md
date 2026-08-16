# Issue intake and triage

NexPress uses GitHub Issues for actionable bug reports, first-run feedback,
and bounded feature proposals. Usage questions and open-ended design
discussion belong in [GitHub Discussions](https://github.com/nexpress-cms/nexpress/discussions).
Security vulnerabilities must be reported privately through
[GitHub Security Advisories](https://github.com/nexpress-cms/nexpress/security/advisories/new),
as described in [`SECURITY.md`](../SECURITY.md).

## Intake routes

- [Bug report](https://github.com/nexpress-cms/nexpress/issues/new?template=bug_report.yml)
  for reproducible incorrect behavior.
- [Install / first-run feedback](https://github.com/nexpress-cms/nexpress/issues/new?template=install_feedback.yml)
  for scaffold, setup, first development run, deploy, and upgrade friction.
- [Feature request](https://github.com/nexpress-cms/nexpress/issues/new?template=feature_request.yml)
  for a concrete problem and a proposed product improvement.
- [GitHub Discussions](https://github.com/nexpress-cms/nexpress/discussions)
  for questions or exploration that is not yet an actionable issue.

Never paste secrets, tokens, private customer data, or unredacted personal
information into a public issue.

## Maintainer cadence

Maintainers review new and reopened issues at least once each week. Security
reports bypass this public cadence and are handled privately as soon as they
are seen.

The issue workflow adds `triage` to every new or reopened issue. During intake,
a maintainer:

1. confirms the route and affected surface;
2. removes secrets or personal data from consideration and asks the reporter
   to rotate any exposed credentials;
3. adds `needs reproduction` when the report lacks enough evidence to act;
4. assigns one priority when the issue is accepted; and
5. removes `triage` once the next state is clear.

## Priority labels

- `priority: high` — blocks installation, upgrade, or safe operation and has
  no reasonable workaround.
- `priority: medium` — an important defect or improvement with a reasonable
  workaround.
- `priority: low` — non-blocking polish, documentation, or ergonomics.

Priority measures user impact and recovery cost, not how quickly a patch can
be written. `needs reproduction` is an evidence state, not a priority.

## Good first issues

Use `good first issue` only when the expected result is bounded, the relevant
files or subsystem are named, tests or verification steps are clear, and the
task does not require a new security, privacy, payment, or persistence policy.
Add `help wanted` when maintainers are ready to review an external change.

## From issue to release

Implementation pull requests should link the accepted issue and use
`Closes #<number>` when merging the PR should close it. Consumer-visible
changes to published `@nexpress/*` packages require a changeset. Version
packages remain a separate release PR and are never folded into the feature
pull request; see [`releasing.md`](releasing.md).
