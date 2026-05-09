---
"@nexpress/theme": patch
"@nexpress/theme-magazine": minor
"@nexpress/web": patch
---

**F.7.1 — theme error delegation pattern (working through the
Next.js client-only constraint).**

The v0.2 contract reserved `NpThemeImpl.error` for theme-shipped
error UI, but Next requires `error.tsx` to be a client component
— and a server-side reference declared on a theme's `impl`
can't cross the React server→client boundary. F.7 kept the slot
as a forward-compat type marker and shipped a framework default;
F.7.1 closes the loop with a working pattern.

### How it works

| Layer | Responsibility |
|---|---|
| Theme package | Ships a CLIENT error component at `./components/error` subpath (`"use client"` banner, separate tsup entry, exports map declares the path) |
| Site layout | Already emits `<style data-np-theme="<id>">` for the theme's CSS — the id is in the DOM by the time error.tsx mounts |
| Site `error.tsx` | Maintains a `THEME_ERRORS` registry of theme-id → `lazy(() => import("@nexpress/theme-X/components/error"))`. Reads active theme via `useActiveThemeId` (queries the style tag), lazy-loads the matching theme's chunk, falls back to framework default |

### Bundle impact

Only the active theme's error chunk downloads — `lazy()` defers
the import until `<ThemeError>` renders, which only happens after
the boundary fires + the active theme matches the registry.
Themes not in the active theme don't reach the client bundle.

### Reference implementation

- `packages/themes/magazine/src/components/error.tsx` — pilot
  theme error: editorial "Stop the press" treatment with the
  magazine's serif heading + CTA button. Uses theme CSS
  custom properties (`--np-color-foreground`, `--np-font-heading`)
  so it matches the masthead even before the rest of the page
  rehydrates.
- `apps/web/src/app/(site)/error.tsx` — site-level delegator
  with the registry + lazy imports + framework default.

### Adding a new theme to the pattern

1. Add `src/components/error.tsx` with `"use client"` at the top.
2. Register the entry in `tsup.config.ts` under the second build
   (the one with `banner: { js: '"use client";' }`).
3. Add the path to `package.json`'s `exports`:
   ```json
   "./components/error": {
     "types": "./dist/components/error.d.ts",
     "import": "./dist/components/error.js"
   }
   ```
4. In the site's `error.tsx`, add a row to `THEME_ERRORS`:
   ```ts
   yourTheme: lazy(() => import("@nexpress/theme-yours/components/error")),
   ```

Themes that don't opt in keep falling through to the framework
default — no breaking change for portfolio / docs / minimal /
default.

### Why the slot stays on `NpThemeImpl`

`impl.error?: ComponentType` remains as a forward-compat type
marker. If Next eventually adds a server-rendered error
fallback API, the framework can wire it transparently from the
server-side reference and remove the operator-maintained
registry. The JSDoc points operators at the F.7.1 pattern in
the meantime.
