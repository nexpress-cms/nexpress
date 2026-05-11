---
"@nexpress/theme-default": patch
---

**Phase F.9-D — v0.2 theme contract phase closure.**

Closes the v0.2 theme contract extension phase. Documentation
update + `theme-default` / `theme-minimal` deprecation
annotations. No code surface changes.

### What this PR ships

- **`docs/design/theme-v0.2-extension.md` marked Frozen
  (shipped)** — the design doc moves from "design phase" to
  "shipped" status snapshot. Implementation diverged where
  noted (F.7 error.tsx Next constraint, F.9.1 polish items);
  the `docs/theme-authoring.md` cookbook is the live API
  reference.

- **`docs/theme-authoring.md` updated**:
  - Reference theme table reorganized — magazine / docs /
    portfolio listed first as v0.2 references with their
    surface coverage; default / minimal annotated as v0.1-era
    back-compat.
  - New "v0.2 surfaces cheat-sheet" table mapping each new
    field to the cookbook section explaining it.

- **`theme-default` + `theme-minimal` JSDoc deprecation
  annotations** — both themes still ship and work, but the
  doc comment now points new sites at the v0.2 references.
  No runtime change.

- **AGENTS.md "Last refreshed" updated** — front-line
  pointers from the agent context now mention v0.2 contract,
  the three reference themes, and `pnpm nexpress
  theme:install`.

### What's NOT in this PR (intentional)

The original design doc §1 decision C said:
> Reference theme count after rebuild: 3 (`magazine`, `docs`,
> `portfolio`). `default` + `minimal` collapse into
> `magazine` settings variants.

We **explicitly defer the absorption** — collapsing 1200+
lines of distinct `theme-default` shell/template/CSS code
into magazine as a `layout: "default"` settings variant
amounts to a magazine rewrite. The validation gate (3 themes
exercising every contract surface) is met without the
absorption; doing the rewrite for a one-time cleanup is poor
return on time.

`theme-default` / `theme-minimal` stay registered + functional;
they just don't participate in v0.2's operator-no-code workflow.
Recorded as a v0.3 candidate when there's more demand for the
specific layout variants they offer.

### F.9.x deferred follow-ups (recorded across the phase)

For posterity — every "deferred" item from F.1 through F.9-C
in one place:

- **F.5.1**: pattern picker UI redesign (categories +
  thumbnails); image-grid item editor; section-strip item
  editor
- **F.6.1**: nav editor "Location assignments" panel
- **F.7.1**: theme `error` component delegation (blocked by
  Next's error.tsx-must-be-client-component constraint)
- **F.9.1**: theme components reading `getThemeSettings` (all
  three v0.2 themes have schema validation but render with
  hardcoded defaults today)
- **F.3 follow-up**: textarea support for `z.string()` in the
  auto-form generator
- **F.8 follow-up**: `theme:uninstall` CLI; cross-theme
  migration cleanup
- **default/minimal absorption** (this PR's intentional
  defer)

### v0.2 contract status — shipped

All eight phases (F.1–F.8) merged + three reference themes
(F.9-A/B/C) merged. Operators can now run:

```
pnpm create nexpress my-site
cd my-site
pnpm install
pnpm nexpress theme:install @nexpress/theme-magazine
pnpm db:migrate
pnpm dev
# → admin → activate magazine → tune via theme settings panel
# → drop blocks/patterns in page builder → live, no code
```

The "operator no coding" promise (with the explicit
two-CLI-command boundary) holds end-to-end.
