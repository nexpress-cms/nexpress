# @nexpress/plugin-forum

Forum plugin for [NexPress](https://github.com/nexpress-cms/nexpress) —
threaded discussions on top of the community surface (comments,
reactions, follows, mentions).

## Install

```bash
pnpm add @nexpress/plugin-forum
```

## Usage

```ts
// nexpress.config.ts
import forum, { defineDiscussionsCollection } from "@nexpress/plugin-forum";
import { defaultCollections } from "@nexpress/app/config-defaults";

export default defineConfig({
  // ...
  collections: [...defaultCollections, defineDiscussionsCollection()],
  plugins: [forum],
});
```

Then generate and apply the collection migration:

```bash
pnpm db:generate && pnpm db:migrate
```

The plugin contributes public routes for `/discussions`,
`/discussions/new`, `/discussions/:slug`, `/discussions/:slug/edit`,
and `/u/:handle/discussions`.

For the plugin model and extension points, see
[`@nexpress/plugin-sdk`](https://www.npmjs.com/package/@nexpress/plugin-sdk).

## License

MIT
