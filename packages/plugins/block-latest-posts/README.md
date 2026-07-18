# @nexpress/plugin-block-latest-posts

Adds a server-rendered latest-documents block for any active NexPress
collection.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-block-latest-posts
```

The Admin props form selects the collection, result limit, layout, and heading.
Rendering uses the read-only `NpBlockRenderContext`, so collection access,
publication filtering, and site scope stay inside the normal content pipeline.
See the
[plugin block guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-blocks.md).

## License

MIT
