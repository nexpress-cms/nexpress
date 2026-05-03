# Releasing

NexPress uses Changesets for versioning. The release workflow currently runs in
version-PR mode only: it builds, typechecks, and opens or updates the "Version
Packages" PR, but it does not publish to npm yet.

Publishing is intentionally gated until the first public `0.1.0` cut is ready.
Before enabling npm publishing:

1. Confirm ownership of the `@nexpress` npm scope and the `create-nexpress`
   package name.
2. Add an `NPM_TOKEN` repository secret with publish rights for every public
   package.
3. Keep `permissions.id-token: write` in `.github/workflows/release.yml` so
   `npm publish --provenance` can attach Sigstore provenance.
4. Restore `publish: pnpm release` on the `changesets/action` step.
5. Run the full CI matrix on the version PR before merging it.
6. After publish, verify each package with `npm view <package> version` and a
   clean `npx create-nexpress` smoke test.

The root `release` script already runs `pnpm build && changeset publish`.
Changesets reads `.changeset/config.json`, where `access: "public"` makes
scoped packages publishable without per-package `publishConfig` blocks.

## Package Checklist

Before a public release, every published package should have:

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `package.json` metadata with repository, homepage, bugs, keywords, and files
- a dry-run tarball check via `pnpm pack --dry-run --json`

The reference app package `@nexpress/web` is private and ignored by Changesets.
