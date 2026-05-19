---
"create-nexpress": patch
---

Resyncs `packages/cli/templates/snapshot/` against `apps/web/src/`. Two route wrappers had drifted out of the scaffold since they were added in apps/web without a matching `pnpm sync-snapshot` run:

- `app/api/admin/themes/reseed/route.ts` — the destructive reseed endpoint the admin theme switcher's "Switch & reseed" / "Reseed demo" dialog calls. Without this file, scaffolded sites 404'd on `GET /api/admin/themes/reseed?themeId=…` and the dialog surfaced "Unable to read current state."
- `app/api/newsletter/route.ts` — the public newsletter signup endpoint.

Also adds a CI guard (in the `scaffold-smoke` job) that runs `sync-snapshot` and fails when it produces a diff, so this exact drift can't reach `main` again silently. The check is idempotent and adds ~2s to the job.

If you scaffolded a site between #791 (reseed UI) / the newsletter route landing and this fix, you have two options:

1. Re-scaffold (clean), or
2. Copy the two wrapper files from this repo's `packages/cli/templates/snapshot/src/app/api/{admin/themes/reseed,newsletter}/route.ts` into your project's `src/app/api/...` (same paths). The wrappers are 2 lines each.
