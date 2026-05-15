---
"create-nexpress": patch
"@nexpress/app": patch
---

chore: theme picker moves to the browser wizard; CLI keeps a flag for headless

The scaffold CLI used to **always** ask "Theme?" up front and then
the browser wizard at `/admin/setup` re-asked the same question.
Two pickers for one decision — and the CLI's interactive prompt
was the wrong place since the operator hasn't seen any of the
themes yet at scaffold time.

The interactive prompt is gone. `/admin/setup` (browser) is now
the sole place an operator picks a theme. The four built-in
themes are bundled into every scaffold regardless.

`--theme <id>` survives as a flag-only escape hatch for headless /
CI installs that can't open the wizard:

```sh
pnpm create nexpress my-site --theme magazine --yes
```

The flag writes `NP_ADMIN_THEME=<id>` into the scaffold's `.env`;
`/admin/setup` reads that env var as the picker's initial
selection (operators with a browser can still arrow-key to swap).
Without the flag, `NP_ADMIN_THEME` is left commented in `.env`
and the wizard's first registered theme is selected by default.

Removed:

  - `create-nexpress`: the interactive theme select prompt (the
    flag stays). `BUILTIN_THEMES` simplified to a `BUILTIN_THEME_IDS`
    string list used only for flag validation.
  - `@nexpress/app`: no public-surface change. `prefill.themeId`
    stays on `<SetupWizard>`; only its source changed (from
    "CLI prompt → env" to "CLI flag → env" — same env var).

Migration: nothing required. Operators with a browser stop seeing
the CLI prompt; operators using `--theme <id>` see no change.
