# create-nexpress

## 0.1.7

### Patch Changes

- 0114041: Two scaffold fixes addressing the "fresh project's `pnpm setup` silently fails on migrate" report:

  **1. Per-project default DB name.** The previously-hardcoded `DATABASE_URL=postgres://nexpress:nexpress@localhost:5433/nexpress` collided with every other NexPress project on the same machine — including the NexPress monorepo's own dev DB (which uses the same URL via `docker/docker-compose.yml`). Operators scaffolding their first project saw migration "succeed" against a DB that already had a different project's 31 tables, producing a silent drizzle-kit exit-1 on `CREATE TABLE` conflict.

  Now `.env`, the setup wizard's CLI prompt default, and the HTML form's prefilled value all derive the DB name from the project directory's basename (sanitized to lowercase + underscores). A project called `my-site` gets `localhost:5433/my_site`. Operators still need to `CREATE DATABASE <name>` on their Postgres, but the resulting error ("database does not exist") is explicit instead of silent.

  Also unified the previously-inconsistent port default (CLI mode said 5432; HTML / `.env` said 5433) on 5433, matching the docker-compose preset the README references.

  **2. Pre-flight check before applying migrations.** `runMigrations` now connects to the target DB and counts existing `np_*` tables before invoking `drizzle-kit migrate`. If any are found, it short-circuits with a clear actionable message:

  ```
  Database 'foo' already contains 31 NexPress tables (np_*).
  Another project is using this DB. Pick a different DB name in DATABASE_URL,
  or drop + recreate the DB:
    psql -c "DROP DATABASE foo; CREATE DATABASE foo;"
  Then re-run setup.
  ```

  The wizard's browser UI renders this message in a `<pre>` block (instead of the generic "see your terminal" pointer). Connection failures still fall through to drizzle-kit's own error path so legit DB-not-found / wrong-credentials cases aren't misdiagnosed as collisions.

## 0.1.6

### Patch Changes

- d6d45c7: Migration child processes (`db:generate`, `pnpm exec drizzle-kit migrate`) now always use `stdio: "inherit"` — including in HTTP wizard mode. drizzle-kit only emits its real progress / error output when it has a real TTY; piped stdio left the captured buffer with just two spinner frames and silently dropped the actual error.

  Inheriting hands the child whatever stdio the wizard parent has, which is the operator's actual terminal. The browser UI loses captured output but the terminal now shows exactly what running `pnpm exec drizzle-kit migrate` directly would show — same source, same formatting, same error fidelity.

  The wizard UI's "migrations FAILED" state was updated to match: instead of an empty `<details>` toggle, it points the operator at their terminal and shows the exact re-run command (`cd <project> && pnpm exec drizzle-kit migrate`).

## 0.1.5

### Patch Changes

- 2e5a876: Make migration failures visible in `pnpm setup`, both in the browser UI and direct CLI runs.

  The previous "silent-fail guard" only fired when the child's captured buffer was completely empty — drizzle-kit shipping a single ANSI escape sequence or newline left the buffer non-empty but visibly blank, so the empty `<details>` toggle stayed empty. Direct `pnpm db:migrate` was even worse: it goes through `pnpm run` → script → drizzle-kit, and somewhere in that chain drizzle-kit's silent exit on non-TTY became `ELIFECYCLE exit 1` with nothing else.

  Three changes:
  1. **Always append an exit-code footer** to every `runChild` call, regardless of buffer content. Footer shows `'cmd' exited with code N` and (on non-zero) the exact command line to re-run directly. Footer goes to terminal stderr AND into the captured output the browser UI shows.
  2. **CLI / non-interactive modes use `stdio: "inherit"`** so the child writes straight to the operator's terminal — no pipe buffering, no TTY-detection quirks, no chance of an interactive prompt failing to render.
  3. **Drop `strict: true` from the scaffolded `drizzle.config.ts`.** With strict on, drizzle-kit prompts the operator to confirm potentially-destructive diffs. When run as a child with piped stdio (which the wizard does in HTTP mode), the prompt can't render — drizzle-kit detects the non-TTY, exits silently with code 1. Operators who want strict diff prompts run `pnpm exec drizzle-kit migrate --strict` directly.

  Also switched the wizard's `pnpm run db:migrate` invocation to `pnpm exec drizzle-kit migrate` — bypasses one pnpm script wrapper layer that has historically swallowed drizzle-kit stderr.

## 0.1.4

### Patch Changes

- 7d5cf08: **Setup wizard polish + headless modes.**

  The scaffolded `pnpm run setup` wizard now supports two new modes for environments where opening a browser tab isn't practical:

  ```bash
  pnpm run setup -- --cli              # terminal prompts via readline
  pnpm run setup -- --non-interactive  # read everything from env vars
  ```

  Auto-detects SSH (`SSH_TTY` / `SSH_CONNECTION`) and headless Linux (no `DISPLAY` / `WAYLAND_DISPLAY`) and falls back to `--cli` automatically. The default browser wizard still opens on desktop terminals.

  Non-interactive mode reads:

  | Env var                                            | Required?                    | Default                                      |
  | -------------------------------------------------- | ---------------------------- | -------------------------------------------- |
  | `DATABASE_URL`                                     | yes                          | —                                            |
  | `NP_SECRET`                                        | no                           | auto-generated 64-char hex                   |
  | `SITE_URL`                                         | no                           | `http://localhost:3000`                      |
  | `NP_STORAGE_ADAPTER`                               | no                           | `local` (set to `s3` for S3)                 |
  | `NP_S3_BUCKET` / `NP_S3_REGION` / `NP_S3_ENDPOINT` | when `NP_STORAGE_ADAPTER=s3` | —                                            |
  | `TEST_DATABASE_URL`                                | no                           | —                                            |
  | `NP_SETUP_RUN_MIGRATIONS`                          | no                           | `true` (set to `false` to skip auto-migrate) |

  Additional fixes bundled in:
  - **Setup wizard output visibility.** `runChild` now spawns with `shell: true` so the chained `pnpm schema:gen && drizzle-kit generate` script's stderr flows through the wizard's tee. Some operators previously saw an empty `<details>` toggle in the UI even though direct terminal runs printed a full stack trace.
  - **Silent-fail guard.** If the spawned child exits non-zero but produces nothing on stdout/stderr, the captured output is replaced with a one-line placeholder pointing the operator at the direct-terminal-run workaround. Better than an empty toggle.
  - **NP_SECRET encoding unified to hex.** Wizard auto-generated secret now uses `randomBytes(32).toString("hex")` (64 chars) instead of `base64url` (~43 chars), matching what `create-nexpress --yes` writes. Same 32-byte entropy; unified encoding so the secret looks the same regardless of which path created the `.env`.

## 0.1.3

### Patch Changes

- eb1b3d5: Scaffolded `pnpm db:generate` failed on first run with "Invalid NexPress config — boot aborted before any service starts" even though `.env` had the values it asked for. Root cause: `scripts/generate-schema.ts` imported `@/nexpress.config` (which zod-validates `NP_SECRET` / `DATABASE_URL` at module-load time) without first loading `.env`. The `_load-env.ts` helper that `doctor.ts` already uses was just missing here. Adds the `import "./_load-env.js"` as the first import, matching the doctor / setup-wizard pattern.

## 0.1.2

### Patch Changes

- 7b31d50: Fix `npx create-nexpress` failing with "template not found: config/.gitignore". npm publish strips dot-prefixed files from the tarball as a default safety measure (so a published package can't ship a `.gitignore` or `.npmrc`), and the on-disk template was named `.gitignore` — so it disappeared from `create-nexpress@0.1.1` even though it existed in `dist/` locally. Renamed the template to `gitignore` (no dot) and updated the loader; the scaffolded project still receives `.gitignore` as the output filename.

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

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.
