---
"@nexpress/theme-docs": patch
---

Fix `apps/web` build leak — `TocScrollspy` (client component)
was being inlined into the docs theme's server bundle, then the
"fix" externalized it via a parent-relative path that escaped
the dist root at consume time.

Root cause:

- `doc-page.tsx` lives at `src/templates/`, so its source import
  read `../components/toc-scrollspy.js`. tsup's string `external`
  does verbatim match on the specifier, and `./components/toc-
  scrollspy.js` (the sibling-path entry the other client
  components used) didn't match the parent-relative form. Result:
  the client module was inlined into `dist/index.js`, RSC blew
  up on the unbannered `useEffect` import. Caught by CI on #741.
- A first fix tried a regex external matching both depths. tsup
  preserved the specifier verbatim, so the bundled `dist/index.js`
  carried `import "../components/toc-scrollspy.js"` — which
  resolves OUTSIDE `dist/` at consume time. Next.js's Turbopack
  reported `Module not found`.

Real fix: the import in `doc-page.tsx` now uses the package
subpath `@nexpress/theme-docs/components/toc-scrollspy`, which
resolves through `package.json` `exports` and is depth-
independent. The subpath is added to the exports map alongside
the existing `./components/error` and `./components/members-
error` entries; tsup externalizes the subpath specifier.

No behavior change — the scrollspy itself is unchanged. Operators
don't need to touch anything.
