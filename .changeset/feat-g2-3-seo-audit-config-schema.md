---
"@nexpress/plugin-seo-audit": minor
---

feat(seo-audit): G.2.3 — declare configSchema, wire operator-tunable thresholds into the audit logic (also fixes a latent decorative-form bug)

Pre-G.2.3 the plugin shipped both:
- hardcoded module-level threshold constants (`TITLE_MIN`, `TITLE_MAX`, `DESCRIPTION_MIN`, `DESCRIPTION_MAX`, `MIN_BODY_WORDS`)
- a hand-rolled `admin.settings.fields` form for those same thresholds

…with no glue between them. Operators could fill the form, save, and absolutely nothing would change in the audit results — the form was decorative. This release ships the G.1 auto-form path as the replacement AND wires `ctx.config` into the audit logic so the saved values actually take effect.

Schema:

```ts
z.object({
  titleMin:           z.number().int().min(0).max(200).default(30),
  titleMax:           z.number().int().min(10).max(300).default(60),
  descriptionMin:     z.number().int().min(0).max(500).default(70),
  descriptionMax:     z.number().int().min(50).max(500).default(160),
  minBodyWords:       z.number().int().min(0).max(10000).default(250),
  includeDescription: z.boolean().default(true),
})
```

Wired through:
- `auditSeo(input, config)` — pure function, exported for unit tests; takes the operator's thresholds as a second arg.
- Hooks (`content:afterCreate`, `content:afterUpdate`) — destructure `{ data, ctx }` and pass `ctx.config` down.
- Plugin actions (`rescanLatest`, `auditDocument`) — read `ctx.config` from setup-time closure.
- Route handlers (`GET /analyze`, `POST /analyze`) — accept `(req, ctx)` and pass through.
- `includeDescription: false` skips ALL description-related issue codes (was effectively a no-op flag in the dead form).

Manifest version 0.2.0; `admin.settings` block removed (auto-form replaces it). Other admin extensions (widgets, actions, tables, dashboardWidgets, collectionTabs) untouched.

Exports `SeoAuditConfig` (no `Np` prefix per the convention from G.2.1) and `auditSeo` (newly exported for tests / sites doing custom audits).

Adds `zod` runtime dep + `vitest` dev dep.

12 unit tests cover schema defaults / range validation / non-integer rejection, plugin metadata invariants (version, capabilities, no `admin.settings`, kept widgets/actions/etc.), and the operator-tuned audit logic (custom titleMin flags shorter titles, default config doesn't flag a 50-char title, includeDescription=false skips description checks, raised minBodyWords flags more docs as thin, perfect doc scores 100).

## block-newsletter — not in this PR

The G.2 design doc § 5.2 originally listed `block-newsletter` alongside seo-audit, but the actual plugin is block-only with per-instance `propsSchema` (each block instance carries its own listId/buttonText/etc.). There's no plugin-global config to migrate — the "provider config" entry in the design doc was aspirational. The plugin stays unchanged in G.2.3.
