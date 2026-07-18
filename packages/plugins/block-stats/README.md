# @nexpress/plugin-block-stats

Adds a live, server-rendered document-count block for any active NexPress
collection.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-block-stats
```

The block reads through `NpBlockRenderContext.content.count`, keeping site
scope and collection access inside the normal read contract. Authors configure
the collection and translatable label in Admin. See the
[plugin block guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-blocks.md).

## License

MIT
