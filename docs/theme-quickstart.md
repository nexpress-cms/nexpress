# Theme author quickstart

Build a local NexPress theme package, register it in a scaffolded site, and
activate it from the admin.

For the full theme contract, read [`theme-authoring.md`](theme-authoring.md).
This page is the shortest working path.

## Prerequisites

- A working NexPress project from `create-nexpress`.
- Node 20+, pnpm 10.33.
- The project has installed dependencies (`pnpm install`) and a working
  `src/nexpress.config.ts` with the theme marker comments from the scaffold.

## 1. Scaffold the theme

Run from the project root:

```bash
pnpm exec nexpress create theme newsroom --workspace
```

That writes `packages/themes/newsroom` with package name `theme-newsroom`.
The package exports `newsroomTheme`, which matches what `nexpress theme add`
will insert into `src/nexpress.config.ts`.

The generated theme includes:

- `src/index.ts` with `defineTheme(...)`
- `src/shell.tsx`, `src/header.tsx`, `src/footer.tsx`
- `src/templates/page-default.tsx`
- `src/styles.ts`
- package-local `tsconfig.json`, `tsup.config.ts`, and `README.md`

If you want a custom destination, use `--out <dir>` instead of `--workspace`.
For local theme development, keep the package under `packages/themes/*` so pnpm
can install it as a workspace package.

## 2. Build it

```bash
pnpm install
pnpm --filter theme-newsroom build
```

`theme add` refuses to register a local workspace theme if its runtime
`dist/index.js` is missing. It also imports the named theme export and runs the
theme definition contract before changing project config. Missing artifacts,
the wrong export shape, and invalid manifests or implementation surfaces stop
at the CLI instead of reaching Next.js boot.

## 3. Register it

```bash
pnpm exec nexpress theme add theme-newsroom --yes
```

For a local workspace theme, the command installs
`theme-newsroom@workspace:*` at the pnpm workspace root, updates the theme
marker sections in `src/nexpress.config.ts`, and probes the package export
shape and complete React-free definition contract.

The config change looks like:

```ts
import { newsroomTheme } from "theme-newsroom";

export default defineConfig({
  themes: [...defaultThemes, newsroomTheme],
});
```

## 4. Regenerate and migrate

The starter theme does not add collection fields, but the normal theme workflow
stays the same:

```bash
pnpm db:generate
pnpm db:migrate
```

Run those commands whenever a theme declares fields under
`manifest.requires.collections`. The framework merges those requirements at
config-resolution time; theme packages should not edit `src/collections/*`
directly.

## 5. Activate it

Restart `pnpm dev` or redeploy so the boot-time theme registry sees the new
package. Then open Admin -> Settings -> Theme and activate the new theme.

## Next edits

- Change `manifest.name`, `description`, and `author` in `src/index.ts`.
- Replace the header/footer markup.
- Update `src/styles.ts` for layout CSS.
- Add page or post templates under `src/templates/` and register them in
  `impl.templates`.
- When the theme needs extra collection fields, add
  `manifest.requires.collections` and run `pnpm db:generate && pnpm db:migrate`.

Keep server and client components split. If you add `useState`, `useEffect`, or
browser event handlers, move that widget into a separate client entry and follow
the server/client boundary notes in [`theme-authoring.md`](theme-authoring.md).
