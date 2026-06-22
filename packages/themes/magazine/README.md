# @nexpress/theme-magazine

Magazine theme for [NexPress](https://github.com/nexpress-cms/nexpress).
Editorial layout — strong typography, image-forward grid, dense
metadata. Suited for blogs, news sites, longform.

## Install

```bash
pnpm add @nexpress/theme-magazine
```

```ts
// nexpress.config.ts
import { magazineTheme } from "@nexpress/theme-magazine";

export default defineConfig({
  // ...
  themes: [magazineTheme],
  defaultTheme: magazineTheme.manifest.id,
});
```

For authoring your own theme see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme) and
[docs/theme-authoring.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md).

## License

MIT
