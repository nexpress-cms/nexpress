# @nexpress/app

Shared Next.js 16 page, route, script, and configuration implementations for
[NexPress](https://github.com/nexpress-cms/nexpress). The private reference app
and projects created by `create-nexpress` use thin local wrappers around this
package so framework fixes arrive through package upgrades.

## Host boundary

This is a framework-host package, not a general React component library.
Generated projects normally consume its `admin/*`, `site/*`, `member/*`,
`api/*`, `root/*`, `scripts/*`, and `lib/*` subpaths through scaffold-owned
files. Unwrap one of those files only when the project intentionally takes
ownership of that behavior.

The package also exports shared Next, Drizzle, PostCSS, and TypeScript config:

```ts
// next.config.ts
import { createNextConfig } from "@nexpress/app/config/next-config";

export default createNextConfig();
```

The TypeScript base contains compiler defaults only. Consumer projects keep
their own `include`, `exclude`, and `@/*` path mapping so TypeScript always
checks the consumer source graph rather than files under `node_modules`.

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [Site customization](https://github.com/nexpress-cms/nexpress/blob/main/docs/site-customization.md)
- [Bootstrap runtime](https://github.com/nexpress-cms/nexpress/blob/main/docs/bootstrap.md)

## License

MIT
