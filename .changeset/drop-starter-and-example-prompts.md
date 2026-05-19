---
"create-nexpress": patch
---

Drops the starter / theme picker and the "Include example content?" toggle from `create-nexpress`. The scaffold now always ships the four built-in themes (`default`, `magazine`, `portfolio`, `docs`) and the example collections + plugins. The active theme and whether to seed sample content are picked in the first-boot admin setup wizard at `/admin/setup`, where the wizard's picker is already authoritative.

Why: the scaffold-time starter pick wasn't visibly functional — picking `magazine` at `npx create-nexpress` time still rendered the default theme until the operator completed the admin wizard (where they pick the theme again). The "Include example content?" toggle behaved similarly: the toggle's "no" path produced an empty scaffold that doesn't render, but operators almost always want the working defaults, then prune later.

Removed surface (every removal is a breaking-by-script change, but pre-1.0 patch per the project's release policy):

- `--starter <id>` / `--starter=<id>` flag
- `--theme <id>` / `--theme=<id>` flag
- `--example` / `--no-example` flag
- Interactive "Pick a starter" prompt
- Interactive "Include example content?" prompt
- `BUILTIN_THEME_IDS`, `STARTER_OPTIONS`, `STARTER_TO_THEME`, `resolveStarter` exports from `./prompts`
- `themeId`, `includeExampleContent` fields on `ProjectConfig` and `CliFlags`

The scaffold's `.env` keeps the commented `# NP_ADMIN_THEME=default` hint for headless / CI installs that need to pre-commit a theme; uncommenting it pre-selects the picker in the admin wizard.
