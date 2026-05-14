---
"@nexpress/theme-docs": patch
---

Fix CI failure on cold builds — `TocScrollspy`'s import in
`doc-page.tsx` is now routed through a sibling-depth bridge
module instead of a package self-import.

CI on #742 failed at the docs theme's DTS step:

```
src/templates/doc-page.tsx: error TS7016: Could not find a
declaration file for module '@nexpress/theme-docs/components/
toc-scrollspy'.
```

Root cause: tsup runs the two configured entry blocks in parallel.
When `dist/index.d.ts` is being generated for the first block, it
hits the self-import to `@nexpress/theme-docs/components/toc-
scrollspy`. TypeScript follows `package.json` `exports` and finds
the `.js` path, but the matching `.d.ts` is still being written by
the second block. The DTS pass fails on `TS7016`.

The previous fix (subpath self-import + adding the path to
`exports`) worked in incremental local builds (where a previous
`dist/components/toc-scrollspy.d.ts` already existed) but failed
on every cold CI run.

This fix routes the import through `src/toc-scrollspy-bridge.ts`
(a tiny re-export at sibling depth to `index.ts`). The bridge
gets inlined into `dist/index.js` because it's not in `external`;
its own `./components/toc-scrollspy.js` import IS external, so
the final bundle carries `import "./components/toc-scrollspy.js"`
— resolves to `dist/components/toc-scrollspy.js` cleanly without
crossing the package boundary. No self-import, no dts race.

The package's `./components/toc-scrollspy` subpath was added in
the previous attempt and is now removed (was only there to
support the now-deleted self-import). `clean: true` is also moved
out of the tsup config into the npm script (`rm -rf dist && tsup`)
following the same pattern documented for `@nexpress/next` and
the forum plugin.
