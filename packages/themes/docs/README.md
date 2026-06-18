# @nexpress/theme-docs

Documentation theme for [NexPress](https://github.com/nexpress-cms/nexpress).
Optimized for reference docs, guides, changelogs, and structured
knowledge bases.

## Install

```bash
pnpm add @nexpress/theme-docs
```

## Usage

```ts
// nexpress.config.ts
import docsTheme from "@nexpress/theme-docs";

export default defineConfig({
  // ...
  themes: [docsTheme],
  defaultTheme: docsTheme.manifest.id,
});
```

For authoring your own theme, see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme) and
[docs/theme-authoring.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md).

## License

MIT
