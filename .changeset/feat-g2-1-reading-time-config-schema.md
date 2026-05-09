---
"@nexpress/plugin-reading-time": minor
---

feat(plugin-reading-time): G.2.1 — declare configSchema, expose words-per-minute as an operator-tunable setting

`reading-time` is the first plugin to opt into the G.1 auto-form path. Pre-G.2.1 the reading-speed constant was hardcoded (`WORDS_PER_MINUTE = 200`); operators couldn't tune it without forking the plugin. This release replaces the constant with a Zod `configSchema` that the framework introspects into a labeled number input on `/admin/plugins/reading-time`.

Operator-facing change:
- New form at `/admin/plugins/reading-time` with a single field "Words per minute" (50 – 800, default 220).
- Saved values persist to `np_settings (key="plugin.config:reading-time")` and are picked up by the next hook / route dispatch.

Plugin-author surface:
- `definePlugin<NpReadingTimeConfig>({…, configSchema, …})` — generic param flows `wordsPerMinute` typing through to `ctx.config` in hooks and route handlers.
- Hooks now read `ctx.config.wordsPerMinute` instead of the module constant.
- `GET /api/plugins/reading-time/estimate` returns the *operator-configured* WPM in its response payload, not the legacy hardcoded 200.

Default WPM bumped 200 → 220 to match the design doc § 5.2 reference (also closer to the wider blog-platform consensus: Medium 250, Substack 240, modern silent-reading research clusters around 220–250 WPM). Sites that want the previous behavior can set 200 explicitly via the new admin form.

Manifest version bumped to 0.2.0.

12 new unit tests cover the schema (defaults, range validation, fractional rejection), the plugin metadata invariants, and the `estimateMinutes` math (regression guard for the 200 → 220 default change).

The plugin exports `ReadingTimeConfig` (no `Np` prefix — that prefix is reserved for framework-owned identifiers per CLAUDE.md "Naming convention"; plugin-owned types use the plugin's own namespace).
