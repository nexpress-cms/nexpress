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
import portfolioTheme from "@nexpress/theme-portfolio";

export default defineConfig({
  // ...
  themes: [portfolioTheme],
  defaultTheme: portfolioTheme.manifest.id,
});
```

For authoring your own theme see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme).

## License

MIT
