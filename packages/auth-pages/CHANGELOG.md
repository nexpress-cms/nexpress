# @nexpress/auth-pages

## 0.4.1

### Patch Changes

- @nexpress/core@0.4.1
- @nexpress/next@0.4.1

## 0.4.0

### Patch Changes

- 3adebdb: Unify staff and member authentication around exact identity, JWT, API wire, credential, runtime configuration, and one-row browser-session contracts. Runtime authentication now recognizes `NP_SECRET` as its only signing-key environment variable and fails closed for malformed JWT, lockout, invitation, reset, verification, or OAuth-state settings. Refresh compare-and-swap rotates access and refresh hashes, logout revokes the pair through either live token's shared session id, password replacement and whole-identity revocation commit atomically, single-use credentials reject concurrent replay, OAuth state cookies share the signed token lifetime, and doctor validates runtime configuration plus persisted auth/session rows.
- fdcbfd3: Unify process bootstrap behind the exact `read`, `plugins`, `worker`, and
  `write` intents. Startup is race-safe, retryable, and fail-closed; terminal
  shutdown drains every owned resource in dependency order. Framework-only raw
  singleton wiring moves from the core root to `@nexpress/core/bootstrap`, while
  apps, workers, standalone scripts, generated code, and scaffolds use the same
  `createBootstrap()` contract.
- 257b120: Unify transactional email messages, adapters, SMTP environment parsing,
  credential expirations, auth job payloads, web and worker delivery,
  diagnostics, and scaffold guidance behind one fail-closed runtime contract.
- 23c1f69: Unify REST errors behind one bounded client-safe envelope, fixed framework code/status mapping, fail-closed Next response boundary, and reusable OpenAPI error contract.
- Updated dependencies [257e70f]
- Updated dependencies [7d31c88]
- Updated dependencies [8693411]
- Updated dependencies [3adebdb]
- Updated dependencies [fdcbfd3]
- Updated dependencies [1ff06a7]
- Updated dependencies [922c708]
- Updated dependencies [ab83768]
- Updated dependencies [080fcbf]
- Updated dependencies [257b120]
- Updated dependencies [773bd1a]
- Updated dependencies [21d4748]
- Updated dependencies [c10eb69]
- Updated dependencies [4cef9c8]
- Updated dependencies [a678bb5]
- Updated dependencies [b44257f]
- Updated dependencies [3eb1af7]
- Updated dependencies [27a4f0e]
- Updated dependencies [9eea115]
- Updated dependencies [2e35374]
- Updated dependencies [f3dee13]
- Updated dependencies [ba9f730]
- Updated dependencies [e58c4c8]
- Updated dependencies [f7ee76e]
- Updated dependencies [23c1f69]
- Updated dependencies [fdd684d]
- Updated dependencies [f8ef45e]
- Updated dependencies [cef1583]
- Updated dependencies [3396b1c]
- Updated dependencies [c0a7da6]
- Updated dependencies [bedb705]
- Updated dependencies [91867cc]
- Updated dependencies [3d45e43]
- Updated dependencies [2dce282]
- Updated dependencies [75e6c34]
- Updated dependencies [e0a2092]
- Updated dependencies [8cb026a]
- Updated dependencies [81b3fb5]
- Updated dependencies [f6fa9d1]
- Updated dependencies [5522c32]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
- Updated dependencies [763ce4a]
  - @nexpress/core@0.4.0
  - @nexpress/next@0.4.0

## 0.3.26

### Patch Changes

- 1b3fa11: Harden OAuth onboarding: doctor now reports partial bundled-provider env pairs, OAuth login surfaces honor provider audiences, member login can expose supported providers, and bundled OAuth plugins stay quiet until configured.
- Updated dependencies [64c6c7e]
- Updated dependencies [11e3007]
- Updated dependencies [61d3c2e]
- Updated dependencies [1b3fa11]
- Updated dependencies [e81ebaa]
- Updated dependencies [192270e]
  - @nexpress/core@0.3.26
  - @nexpress/next@0.3.26

## 0.3.25

### Patch Changes

- Updated dependencies [a9b2a81]
- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/next@0.3.25
  - @nexpress/core@0.3.25

## 0.3.24

### Patch Changes

- Updated dependencies [b8cce91]
  - @nexpress/next@0.3.24
  - @nexpress/core@0.3.24

## 0.3.23

### Patch Changes

- @nexpress/core@0.3.23
- @nexpress/next@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/next@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/next@0.3.21

## 0.3.20

### Patch Changes

- @nexpress/core@0.3.20
- @nexpress/next@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/core@0.3.19
- @nexpress/next@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/core@0.3.18
- @nexpress/next@0.3.18

## 0.3.17

### Patch Changes

- @nexpress/next@0.3.17
- @nexpress/core@0.3.17

## 0.3.16

### Patch Changes

- @nexpress/core@0.3.16
- @nexpress/next@0.3.16

## 0.3.15

### Patch Changes

- @nexpress/next@0.3.15
- @nexpress/core@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/next@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/core@0.3.13
- @nexpress/next@0.3.13

## 0.3.12

### Patch Changes

- @nexpress/next@0.3.12
- @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/core@0.3.11
- @nexpress/next@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/next@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/core@0.3.9
- @nexpress/next@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/next@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/core@0.3.7
- @nexpress/next@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/core@0.3.6
- @nexpress/next@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/core@0.3.5
- @nexpress/next@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/next@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/next@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [ad4fcba]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/next@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [07c763b]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
  - @nexpress/core@0.3.1
  - @nexpress/next@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [ab3afa7]
- Updated dependencies [41df9e4]
  - @nexpress/core@0.3.0
  - @nexpress/next@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/next@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/core@0.2.1
- @nexpress/next@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/core@0.2.0
- @nexpress/next@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/core@0.1.6
- @nexpress/next@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/core@0.1.5
- @nexpress/next@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/next@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [7d87406]
  - @nexpress/next@0.1.2
  - @nexpress/core@0.1.2

## 0.1.1

### Patch Changes

- e062ed7: **0.1.1 — post-launch cleanup + first-time UX.**

  Bundles every change since the v0.1.0 first publish into one patch
  release. The npm registry stays on the 0.1.x track; 0.2.0 was
  attempted (and the version-PR landed locally) but the CI publish
  failed end-to-end due to npm 10 not supporting Trusted Publishing
  (npm 11.5.1+ required) — fixed in the release workflow, but the
  0.2.0 bump itself was premature for the size of changes shipped.

  ### `@nexpress/core`
  - `getPluginConfig` read/write asymmetry fixed (#664). `setPlugin`
    writes to `np_settings` for any pluginId; `getPluginConfig` now
    reads it back regardless of whether the plugin is registered.

  ### `@nexpress/admin`
  - Empty-state CTA on `/admin/collections/<slug>` (#666). Truly-empty
    collections render a "Create your first \<singular>" card instead
    of the generic "No documents found" line.
  - Dashboard welcome card → 5-step setup checklist (#666). Tracks
    site name set / first post published / theme chosen / production
    domain set.
  - Topbar user-menu trigger now has `aria-label="Open user menu"`
    (#664) so the e2e selector matches a stable accessible name.

  ### `@nexpress/theme-magazine`, `@nexpress/theme-portfolio`
  - `padding-inline-start` instead of `padding-left` on mobile sub-nav
    lists (#664). Makes RTL locales render with the correct leading
    edge.

  ### Internal (no operator-facing change)
  - Drizzle migration history squashed to a single `0000_init.sql`
    (#646). New installs run one migration to reach the v0.1 schema.
  - Repository transferred from `hahabsw/nexpress` to
    `nexpress-cms/nexpress` (#647). `repository.url` metadata updated
    across every published package.
  - Release workflow: `publish: pnpm run release` restored + npm 11+
    installed before publish so Trusted Publishing actually
    authenticates (#670). The v0.2.0 attempt's E404 was npm 10 not
    supporting the OIDC TP token, not a TP-config mistake.
  - CI noise reduction: docs / changesets / community-file paths
    no longer trigger main-push CI; E2E gated to PRs only.

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
  - @nexpress/next@0.1.1
