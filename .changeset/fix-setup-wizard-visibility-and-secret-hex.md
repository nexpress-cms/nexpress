---
"create-nexpress": patch
---

**Setup wizard polish + headless modes.**

The scaffolded `pnpm run setup` wizard now supports two new modes for environments where opening a browser tab isn't practical:

```bash
pnpm run setup -- --cli              # terminal prompts via readline
pnpm run setup -- --non-interactive  # read everything from env vars
```

Auto-detects SSH (`SSH_TTY` / `SSH_CONNECTION`) and headless Linux (no `DISPLAY` / `WAYLAND_DISPLAY`) and falls back to `--cli` automatically. The default browser wizard still opens on desktop terminals.

Non-interactive mode reads:

| Env var | Required? | Default |
|---|---|---|
| `DATABASE_URL` | yes | — |
| `NP_SECRET` | no | auto-generated 64-char hex |
| `SITE_URL` | no | `http://localhost:3000` |
| `NP_STORAGE_ADAPTER` | no | `local` (set to `s3` for S3) |
| `NP_S3_BUCKET` / `NP_S3_REGION` / `NP_S3_ENDPOINT` | when `NP_STORAGE_ADAPTER=s3` | — |
| `TEST_DATABASE_URL` | no | — |
| `NP_SETUP_RUN_MIGRATIONS` | no | `true` (set to `false` to skip auto-migrate) |

Additional fixes bundled in:

- **Setup wizard output visibility.** `runChild` now spawns with `shell: true` so the chained `pnpm schema:gen && drizzle-kit generate` script's stderr flows through the wizard's tee. Some operators previously saw an empty `<details>` toggle in the UI even though direct terminal runs printed a full stack trace.
- **Silent-fail guard.** If the spawned child exits non-zero but produces nothing on stdout/stderr, the captured output is replaced with a one-line placeholder pointing the operator at the direct-terminal-run workaround. Better than an empty toggle.
- **NP_SECRET encoding unified to hex.** Wizard auto-generated secret now uses `randomBytes(32).toString("hex")` (64 chars) instead of `base64url` (~43 chars), matching what `create-nexpress --yes` writes. Same 32-byte entropy; unified encoding so the secret looks the same regardless of which path created the `.env`.
