# Theme token contract

NexPress uses one validated token tree across theme packages, persisted Admin
overrides, plugin writes, JSON import/export, OpenAPI, and CSS generation.

```ts
interface NpThemeTokens {
  colors: NpThemeColors;
  typography: NpThemeTypography;
  shape: NpThemeShape;
}
```

Theme packages and plugins may submit an `NpThemeTokensOverlay`, where each
group and key is optional. Public rendering and `ctx.theme.getTokens()` always
return the fully resolved `NpThemeTokens` tree:

1. `DEFAULT_THEME`
2. active theme `impl.tokens`
3. the current site's `np_settings.theme` override

Every layer is validated before merging. Unknown groups or keys, non-string
values, missing required keys in a full tree, and unsafe CSS statement or
resource-loading syntax fail closed at the boundary that received them.

## Canonical inventory

| Group        | Keys                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors`     | `primary`, `primaryForeground`, `primarySoft?`, `background`, `foreground`, `muted`, `mutedForeground`, `border`, `card`, `cardForeground`, `accent`, `accentForeground`, `destructive`, `destructiveForeground` |
| `typography` | `fontHeading`, `fontBody`, `fontMono`, `fontSizeBase`, `lineHeight`, `fontSizeSm`, `fontSizeLg`, `fontSizeXl`, `fontSize2xl`, `fontSize3xl`, `fontSize4xl`                                                       |
| `shape`      | `radiusSm`, `radiusMd`, `radiusLg`, `radiusFull`, `shadowSm`, `shadowMd`, `shadowLg`                                                                                                                             |

Values must be trimmed, non-empty strings up to 200 characters. They cannot
contain control characters, `;`, `{`, `}`, `<`, `>`, backslash escapes, CSS comments,
`url(...)`, `image-set(...)`, `src(...)`, `expression(...)`, or `@import`.
These rules keep one token value from opening a second CSS statement or loading
a resource. CSS generation still sanitizes values as defense in depth.

The runtime inventory and validators are client-safe:

```ts
import {
  npThemeTokenGroups,
  npThemeTokenKeys,
  npValidateThemeTokens,
  npValidateThemeTokensOverlay,
  npMergeThemeTokens,
  type NpThemeTokens,
  type NpThemeTokensOverlay,
} from "@nexpress/core/theme";
```

`npValidateThemeTokens()` checks a complete tree. Use
`npValidateThemeTokensOverlay()` for `impl.tokens`, plugin partial writes, and
backup/import payloads. Both return the first issue with its canonical
`theme.<group>.<key>` path; the matching `npAnalyze*` helpers return every
issue.

## Theme authors

Declare only the values your theme owns:

```ts
defineTheme({
  manifest: { id: "newsroom", name: "Newsroom", version: "1.0.0" },
  impl: {
    tokens: {
      colors: { primary: "#1f6feb", background: "#ffffff" },
      typography: { fontHeading: "Inter, system-ui, sans-serif" },
    },
  },
});
```

`defineTheme()`, config resolution, the core registry, and Next bootstrap all
apply the same overlay contract before registration.

## Admin and API

`GET /api/settings/theme` returns the fully resolved tree. `PUT` and `PATCH`
replace the persisted Admin value and require a complete tree. Admin JSON
imports accept a partial overlay and merge it onto the currently displayed
tree before Save. Site backup imports accept a validated overlay because a
backup stores the persisted layer, not the resolved theme package defaults.

Malformed stored rows also fail reads and exports instead of reaching CSS
generation with a cast-only type.

## Plugins

`ctx.theme.getTokens()` requires `theme:read` and returns the fully resolved
tree. `ctx.theme.setTokens(overlay)` requires `theme:write`, validates the
nested overlay, deeply merges it with the existing persisted overlay, and
invalidates the current site's theme cache.

```ts
await ctx.theme.setTokens({
  colors: { accent: "#0f766e" },
  shape: { radiusMd: "0.75rem" },
});
```

Flat token maps and arbitrary keys are not part of this contract.
