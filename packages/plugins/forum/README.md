# @nexpress/plugin-forum

Multi-board forum plugin for [NexPress](https://github.com/nexpress-cms/nexpress).
It combines native board/post collections, member writes, moderation, rich
text, comments, and a build-time skin contract.

## Install

```bash
pnpm add @nexpress/plugin-forum
```

Generated projects already receive `forumCollections` and `forumPlugin` through
the framework defaults. For a custom path, collection names, or skin catalog,
use one paired factory result:

```ts
import { defineConfig } from "@nexpress/core";
import { createForum } from "@nexpress/plugin-forum";

const forum = createForum({
  basePath: "/boards",
  defaultSkinId: "classic",
});

export default defineConfig({
  collections: [...forum.collections],
  plugins: [forum.plugin],
});
```

Generate and apply the two collection tables, then create and publish a board
from Admin → Community → Forum boards:

```bash
pnpm db:generate && pnpm db:migrate
```

The default routes are `/boards`, `/boards/:boardKey`, member create/edit
routes, and UUID-based post detail URLs. A selected skin renders the board
index, post list, detail, and route-owned create/edit content without taking
over authentication or write policy. Members can write only board, title, body,
and category fields; pin, lock, status, board policy, and moderation stay
operator-owned.

See the full [forum guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-forum.md)
for board settings, skin authoring, policy behavior, and current scope.

## License

MIT
