---
"create-nexpress": patch
"@nexpress/app": patch
---

chore: theme picker lives only in the first-boot setup wizard

The scaffold CLI used to ask "Theme?" up front, bake the answer
into `NP_ADMIN_THEME=<id>` in `.env`, and the wizard then read
that env var as the picker's initial selection. Two pickers for
one decision — and the CLI's was the wrong place: the operator
hasn't seen any of the themes yet at scaffold time.

Theme picking now happens exclusively in `/admin/setup` (the
browser wizard) at first boot. The four built-in themes are
bundled into every scaffold regardless, so there's nothing the
CLI needs to commit. Removed:

  - `create-nexpress`: `--theme <id>` flag, the interactive
    select prompt, and the `NP_ADMIN_THEME=<id>` line written
    into `.env` / `.env.example`. The CLI's `BUILTIN_THEMES`
    list is gone too — keeping it in sync with the runtime
    theme list was a pure maintenance tax with no payoff.
  - `@nexpress/app`: the `NP_ADMIN_THEME` read in
    `admin/setup/page.tsx` and the matching `prefill.themeId`
    prop on `<SetupWizard>`. The wizard's first registered
    theme is the new initial selection; operator arrow-keys to
    swap before submitting.

The flag, env var, and prop were all introduced together in
#731. None of them had real consumers outside this loop —
nothing in the repo or in operator-facing docs leans on
`NP_ADMIN_THEME` for anything else.

Migration: drop `--theme <id>` from any scaffold automation;
the wizard will ask. If `NP_ADMIN_THEME` lingers in an existing
`.env`, it's silently ignored (still safe to remove).
