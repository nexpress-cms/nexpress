# Security Policy

## Supported Versions

NexPress is pre-1.0. Security fixes target the current `main` branch and the
latest published `0.x` release line once npm publishing is enabled.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Report security issues through GitHub's private vulnerability reporting for
this repository. If that is unavailable, contact the maintainers privately and
include:

- the affected package, route, or feature
- the impact and required preconditions
- reproduction steps or a proof of concept
- whether the issue is already being exploited or publicly known

We will acknowledge the report as soon as practical, coordinate a fix in a
private branch when needed, and publish release notes that credit reporters who
want attribution.

## Scope

In scope:

- authentication, session, CSRF, OAuth, and password-reset behavior
- authorization and tenant/site isolation failures
- file upload, media processing, import, and SSRF issues
- plugin route isolation, rate limiting, and privilege boundary issues
- secrets exposure in generated projects, logs, packages, or CI

Out of scope:

- denial-of-service reports that require unrealistic local-only access
- findings against unsupported dependencies with no NexPress-specific impact
- social engineering or reports that require compromising maintainer accounts
