# @nexpress/theme-portfolio

Portfolio theme for [NexPress](https://github.com/nexpress-cms/nexpress).
Project-grid landing page, case-study layouts, image-led detail
pages. Suited for design / studio / agency sites.

## Install

```bash
pnpm add @nexpress/theme-portfolio
```

```ts
// nexpress.config.ts
import { portfolioTheme } from "@nexpress/theme-portfolio";

export default defineConfig({
  // ...
  themes: [portfolioTheme],
  defaultTheme: portfolioTheme.manifest.id,
});
```

For authoring your own theme see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme) and
[docs/theme-authoring.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md).

## License

Theme code: MIT.

Instrument Serif (normal and italic) and Hanken Grotesk (variable weight 400–700)
are bundled under the SIL Open Font License 1.1. The shell serves them from the
host's own static assets; no Google Fonts request or CSP exception is needed.
Original font binaries, copyright notices, licenses and pinned upstream sources
are included in `dist/fonts/` in the installed package.
