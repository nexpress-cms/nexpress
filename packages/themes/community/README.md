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

It also styles the framework-owned `.np-comments` / `.np-comment-*` contract.
That enhancement works on any collection that renders the shared comment
component, whether or not the forum plugin is installed; comment data and
actions remain owned by Core and the application routes.

The theme implements the optional `impl.members.publicProfile` renderer over
the framework's PII-free profile and exact public activity props. It works for
any collection that explicitly opts into profile activity and does not import
the forum plugin; an installed forum participates only through the same generic
collection contract.

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
