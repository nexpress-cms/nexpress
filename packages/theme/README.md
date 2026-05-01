# @nexpress/theme

Theme engine for [NexPress](https://github.com/hahabsw/nexpress) — the
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
  },
  tokens: {
    colors: {
      brand: "#1f6feb",
      "brand-foreground": "#ffffff",
      bg: "#f6f8fa",
      fg: "#0f172a",
    },
    fonts: {
      sans: "Inter, system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, monospace",
    },
    radii: {
      md: "0.5rem",
      lg: "0.75rem",
    },
  },
});
```

Register in `nexpress.config.ts`:

```ts
import myTheme from "./themes/my-theme.js";

export default defineConfig({
  // ...
  themes: [myTheme],
  defaultTheme: "my-theme",
});
```

## Render the CSS

```tsx
// app/layout.tsx
import { NxThemeStyle } from "@nexpress/theme/client";
import { getTheme } from "@nexpress/core";

export default async function RootLayout({ children }) {
  const theme = await getTheme();
  return (
    <html>
      <head><NxThemeStyle theme={theme} /></head>
      <body>{children}</body>
    </html>
  );
}
```

This emits CSS like:

```css
:root {
  --color-brand: #1f6feb;
  --color-brand-foreground: #ffffff;
  --font-sans: Inter, system-ui, sans-serif;
  --radius-md: 0.5rem;
  /* ... */
}
```

Use the variables anywhere in your stylesheets.

## Reference themes

The monorepo ships four:

- `@nexpress/theme-default`
- `@nexpress/theme-minimal`
- `@nexpress/theme-magazine`
- `@nexpress/theme-portfolio`

## Links

- [Repository](https://github.com/hahabsw/nexpress)
- [docs/theme-authoring.md](https://github.com/hahabsw/nexpress/blob/main/docs/theme-authoring.md)

## License

MIT
