---
"@nexpress/web": patch
---

**First-run console banner + automated UX audit script.**

Two related changes for the new-operator onboarding experience.

**1) First-run nudge in `apps/web/src/lib/init-core.ts`.** On the
first `ensureFor("read")` of each process, we count admin users
in `np_users`. If there are zero we print a friendly console
banner pointing at `http://localhost:<port>/admin` (the in-app
wizard) plus the headless `pnpm seed:admin` alternative.

Closes a discoverability gap: previously `pnpm dev` finished
booting with Next's generic "Ready in 4s" line and an operator
who didn't know to visit `/admin` could think the setup was
incomplete. The new banner makes the next step obvious.

Fire-and-forget — the DB query runs `void`-ed so request
latency isn't affected. Latches once per process; if the DB
query fails (table missing, migrations pending) we roll back
the latch so the next request retries. Opt out via
`NP_FIRST_RUN_NUDGE=off`.

**2) `scripts/ux-audit.mts` + `pnpm ux-audit` script.** A
non-interactive walk through the new-operator journey:

```bash
pnpm ux-audit               # full audit (scaffold → build → boot → probe → clean)
pnpm ux-audit --keep        # leave the scaffold behind for inspection
pnpm ux-audit --quick       # skip the prod-mode probe
pnpm ux-audit --name foo    # custom scaffold name
```

Steps (each timed, each report includes an actionable hint on
failure):

1. `create-nexpress --local --yes --example --no-docker
   <name>` scaffolds under `packages/cli/<name>` so the
   workspace picks the `workspace:*` deps up.
2. `pnpm install` at the workspace root.
3. `pnpm --filter <name> doctor` — env diagnosis runs without
   crashing (exit 1 is expected on a `.env`-less scaffold).
4. `pnpm --filter <name> build` succeeds with minimal env
   (DATABASE_URL / NP_SECRET / SITE_URL stub).
5. `pnpm --filter <name> start` boots a production server on
   port 3099. HTTP-probe / and /admin; expect /admin to 30x
   redirect.

Output is a structured report — pass/fail per step + total
timing + first-failure hint. Exit code 0 / 1.

This is intentionally NOT:
- a browser-side admin wizard test (Playwright/e2e owns that),
- a real deployment test (platform-specific, deployment.md
  walks operators through that),
- a plugin install / theme switch flow (integration tests
  already cover those).

The script is for catching regressions in the **first 5
minutes** of a new install — the surface most likely to
silently degrade as the framework evolves.

Scaffold scratch dirs (`packages/cli/ux-audit-*` and
`packages/cli/my-nexpress-site`) added to `.gitignore` so the
audit can leave artifacts behind with `--keep` without
polluting the working tree.
