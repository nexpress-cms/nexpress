# @nexpress/plugin-block-embed

Adds a validated YouTube embed block to the NexPress page builder.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-block-embed
```

Authors choose a YouTube URL, aspect ratio, and accessible title. The renderer
normalizes supported YouTube URL forms and emits a lazy iframe with a strict
referrer policy. See the
[plugin block guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-blocks.md).

## License

MIT
