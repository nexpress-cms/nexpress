# @nexpress/theme

Theme engine for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS. Generates CSS custom properties from design tokens,
exposes a typed registry, and emits a single `<style>` tag for SSR.

## Install

```bash
pnpm add @nexpress/theme
```

## Define a theme

```ts
// src/themes/my-theme.ts
import { defineTheme } from "@nexpress/theme";

export default defineTheme({
  manifest: {
    id: "my-theme",
    name: "My Theme",
    version: "1.0.0",
  },
  impl: {
    tokens: {
      colors: {
        primary: "#1f6feb",
        primaryForeground: "#ffffff",
        background: "#f6f8fa",
        foreground: "#0f172a",
      },
      typography: {
        fontBody: "Inter, system-ui, sans-serif",
        fontMono: "ui-monospace, SFMono-Regular, monospace",
      },
      shape: {
        radiusMd: "0.5rem",
        radiusLg: "0.75rem",
      },
    },
  },
});
```

Register in `nexpress.config.ts`:

```ts
import { defineConfig } from "@nexpress/core";
import myTheme from "./themes/my-theme.js";

export default defineConfig({
  // ...
  themes: [myTheme],
});
```

Activate it from Admin → Appearance after the package is registered.

## Render the CSS

```tsx
// app/layout.tsx
import { NpThemeStyle } from "@nexpress/theme";
import { getTheme } from "@nexpress/core";

export default async function RootLayout({ children }) {
  const theme = await getTheme();
  return (
    <html>
      <head>
        <NpThemeStyle theme={theme} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

This emits CSS like:

```css
@layer np-theme {
  :root {
    --np-color-primary: #1f6feb;
    --np-color-primary-foreground: #ffffff;
    --np-font-body: Inter, system-ui, sans-serif;
    --np-radius-md: 0.5rem;
  }
  /* ... */
}
```

Use the variables anywhere in your stylesheets.

The token tree is closed and validated. Import the client-safe inventory and
validators from `@nexpress/core/theme`, or read the full guide at
[`docs/theme-tokens.md`](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-tokens.md).

## Reference themes

The monorepo ships four:

- `@nexpress/theme-default`
- `@nexpress/theme-magazine`
- `@nexpress/theme-portfolio`
- `@nexpress/theme-docs`

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [docs/theme-authoring.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md)

## License

MIT
