---
"create-nexpress": patch
---

Fresh `pnpm install` in a `npx create-nexpress my-site`-scaffolded project no longer warns `ERR_PNPM_IGNORED_BUILDS` and requires an operator-side `pnpm approve-builds` before the framework's native-backed features work.

Root cause: pnpm 10.6+ silently ignores the `pnpm.onlyBuiltDependencies` block in `package.json` for non-workspace (single-package) projects — the new live allowlist is `allowBuilds:` inside `pnpm-workspace.yaml`. The scaffold was still emitting only the legacy `pnpm.onlyBuiltDependencies` block, so even though `sharp` and `@node-rs/argon2` were listed, pnpm wasn't reading them. Confirmed empirically against pnpm 10.33 and 11.1: the warning fires on first install, and `pnpm approve-builds --all` writes a fresh `pnpm-workspace.yaml` with the new format.

Fix:

- Scaffold now emits a `pnpm-workspace.yaml` with `allowBuilds: { sharp, "@node-rs/argon2", esbuild }`. `esbuild` was missing from the old list and was the other source of warnings (transitive via `tsx` / `vite` / `next`).
- The dead `pnpm.onlyBuiltDependencies` block was removed from `package.json` so there's exactly one allowlist in one place.
- New test in `templates.test.ts` asserts the `pnpm-workspace.yaml` exists, lists all three deps, and that `pnpm.onlyBuiltDependencies` is NOT in `package.json` — prevents the two-places-for-one-intent drift from coming back.

Operators scaffolding after this republish run `pnpm install` and get a clean exit. Anyone with a previously-scaffolded site can either re-scaffold or copy this `pnpm-workspace.yaml` content over.
