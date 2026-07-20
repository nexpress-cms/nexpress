# @nexpress/theme-community

An independent Korean community-portal theme for NexPress. It ships a dense,
responsive site shell, portal-style article home, post/page templates, member
surfaces, Korean starter content, and optional styling for the public forum
integration contract.

The theme does not import `@nexpress/plugin-forum`, query forum collections, or
assume the plugin is active. Without the plugin it works as a complete article
community. When the plugin is installed, the theme enhances its documented
`--np-forum-*` variables and `data-np-forum-*` hooks, including post
engagement summaries and the bounded-window popular feed. The theme never
owns forum queries, ranking, view receipts, or reaction state.

```bash
pnpm add @nexpress/theme-community
```

```ts
import { communityTheme } from "@nexpress/theme-community";

export default defineConfig({
  themes: [communityTheme],
});
```

See the [theme authoring guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md)
and [forum integration guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-forum.md).
