# @nexpress/theme-default

Default theme for [NexPress](https://github.com/nexpress-cms/nexpress).
Neutral palette + system fonts; what every scaffolded site lands on
out of the box.

## Install

```bash
pnpm add @nexpress/theme-default
```

## Usage

```ts
// nexpress.config.ts
import defaultTheme from "@nexpress/theme-default";

export default defineConfig({
  // ...
  themes: [defaultTheme],
  defaultTheme: defaultTheme.manifest.id,
});
```

For authoring your own theme, see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme) and
[docs/theme-authoring.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md).

## License

MIT
