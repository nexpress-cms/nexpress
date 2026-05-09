---
"@nexpress/core": minor
---

**v0.3 (D) — `settingsSchema` migration helpers.**

Closes a v0.3-deferred item from
`docs/design/theme-v0.2-extension.md` §10 + the
`feat-theme-settings.md` changeset:

> `settingsSchema` migration helpers — v0.2 falls back to
> defaults on mismatch. Real migration helpers tracked here.

### Problem

In v0.2, when a theme's `settingsSchema` evolved (renamed a
field, removed one, tightened a default), the
`getThemeSettingsWithStatus` read path's `safeParse` would fail
and the runtime fell back to schema defaults — silently blowing
away the operator's customizations on a theme upgrade.

### Solution

Two new optional fields on `NpThemeManifest`:

```ts
defineTheme({
  manifest: {
    settingsSchema: z.object({
      accentColor: z.string().regex(...).optional(),
      ...
    }),
    settingsVersion: 2,
    settingsMigrate: (old, from) => {
      if (from === 1) {
        const o = old as { accent?: string };
        return { ...o, accentColor: o.accent };
      }
      return old;
    },
  }
})
```

| Field | Purpose |
|---|---|
| `settingsVersion?: number` | Theme bumps this when `settingsSchema` changes shape non-additively. Absent / undefined treated as `1` (the v0.2 baseline). |
| `settingsMigrate?(old, fromVersion)` | Pure function bringing a value from `fromVersion` up to `settingsVersion`. Called on read when stored < target. Defensive try/catch — a buggy migrator falls back to the raw value, schema parse decides what to do downstream. |

### Storage

Settings now persist as a versioned envelope:

```json
{
  "__npVersion": 2,
  "__npSettings": { "accentColor": "#abc123", ... }
}
```

Sentinel keys (`__npVersion`, `__npSettings`) avoid collision
with theme-owned settings fields. Legacy v0.2 unwrapped values
(written before this PR) are detected by the absence of the
sentinels and treated as v1 — the migrator runs on first read,
and the operator's NEXT save through the admin form persists
the new envelope.

### Read path behavior

| Scenario | Behavior |
|---|---|
| No row stored | Schema defaults (unchanged from v0.2) |
| Wrapped envelope, version matches | Parse + return (no migration) |
| Wrapped envelope, version < manifest | `settingsMigrate(old, from)` → parse migrated value → return |
| Legacy unwrapped value, manifest at v1 | Parse as-is — fully back-compat |
| Legacy unwrapped value, manifest at v2+ | Treat as v1 → migrate → parse |
| Wrapped envelope, version > manifest (operator downgraded) | No-op → parse → if fails, defaults + parseError |
| Migrator throws | Fall back to raw value → parse → if fails, defaults + parseError |
| Migrated value still doesn't pass schema | Defaults + parseError (admin shows the existing "settings reset" banner) |

### Auto-write?

Read paths don't auto-persist the migrated value. The
migration recomputes on each read until the operator saves
through the admin form, at which point `setThemeSettings` wraps
in the current envelope. This keeps read paths pure (matches
every other cached read in the framework) and avoids
write-amplification on cold reads.

### Tests

12 new unit tests in `settings-migration.test.ts` covering:
- `isVersionedSettings` shape detection (wrapped / legacy /
  primitives / partial sentinel)
- `applyMigration` for: same-version no-op, downgrade no-op,
  no-migrator no-op, single-step + multi-step migrations,
  absent `settingsVersion`, defensive throw handling
