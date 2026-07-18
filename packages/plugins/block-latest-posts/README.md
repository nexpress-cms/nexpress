# @nexpress/plugin-block-latest-posts

Adds a server-rendered latest-documents block for any active NexPress
collection.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-block-latest-posts
```

The Admin props form selects the collection, result limit, layout, and heading.
Rendering reads through the read-only `NpBlockRenderContext` with an explicit
published-status filter, preserving normal collection access and site scope.
See the
[plugin block guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-blocks.md).

## License

MIT
