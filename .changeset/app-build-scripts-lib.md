---
"@nexpress/app": patch
---

Build `scripts/*` and `lib/*` as ESM `.js` artifacts under `dist/` instead of publishing them as raw `.ts` source. `0.2.0` shipped these subpaths as raw `.ts` and the `exports` map pointed at `*.ts` targets behind wildcard patterns — `tsx`'s ESM hook (which scaffolded sites use to run `pnpm setup` / `pnpm dev`) doesn't apply Node export pattern wildcards over `.ts` targets, so every scaffolded site died on `pnpm install` with:

```
ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './scripts/postinstall-notice' is not defined by "exports" in node_modules/@nexpress/app/package.json
```

(0.2.0 was broken-for-everyone — scaffolds couldn't reach `pnpm install` postinstall, never mind `pnpm dev`.)

Root fix is to stop relying on `tsx`'s loader to transpile our published source. `tsup` now builds every subpath we want consumers to import — `scripts/_load-env`, `scripts/setup-server`, `scripts/doctor`, every `lib/*` — into `dist/scripts/*.js` and `dist/lib/*.js`. The `exports` map points at `dist/...` so Node's native ESM resolver handles the path; tsx, Next.js's bundler, and any other consumer get a plain `.js` file with sibling `.d.ts`. The whole class of "wildcard + .ts target" fragility disappears.

What stays raw (`./src/*.tsx` via `exports`):
- `admin/*`, `site/*`, `member/*`, `root/*`, `api/*` — consumed exclusively by Next.js through `transpilePackages`. Next's bundler handles `.tsx` natively, so a second `tsup` build would only duplicate work and risk diverging from Next's expected shape.

The CI gap that allowed 0.2.0 to ship: `scaffold-smoke` only ran `tsc --noEmit` against a fresh scaffold. `tsc` resolves export wildcards over `.ts` targets fine — the runtime regression was invisible at typecheck time. Tracked separately as a CI follow-up; for now this fix has been verified by packing tarballs and running `pnpm install` + `tsx ./scripts/postinstall-notice.ts` in a scaffolded project, both of which were the explicit failures in 0.2.0.
