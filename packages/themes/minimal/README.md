# @nexpress/theme-minimal

Minimal theme for [NexPress](https://github.com/hahabsw/nexpress).
Restrained typography, tight palette, generous whitespace. Good
starting point for a personal site or a custom theme to fork.

## Install

```bash
pnpm add @nexpress/theme-minimal
```

```ts
// nexpress.config.ts
import minimalTheme from "@nexpress/theme-minimal";

export default defineConfig({
  // ...
  themes: [minimalTheme],
  defaultTheme: minimalTheme.manifest.id,
});
```

For authoring your own theme see
[`@nexpress/theme`](https://www.npmjs.com/package/@nexpress/theme).

## License

MIT
