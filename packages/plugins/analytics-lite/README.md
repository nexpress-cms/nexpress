# @nexpress/plugin-analytics-lite

First-party, storage-backed analytics plugin for small NexPress sites. It
injects a tiny page-view collector, respects Do Not Track when configured,
stores bounded daily events, rolls them up on a scheduled task, and exposes
today's views and top paths through declarative Admin surfaces.

```bash
pnpm exec nexpress plugin add @nexpress/plugin-analytics-lite
```

The Admin-generated config form controls whether analytics collection is
enabled, Do Not Track behavior, sampling, endpoint path, and retention. The
plugin contributes `POST /event` and `GET /summary` under
`/api/plugins/analytics-lite`, uses plugin-scoped storage, and declares its
metric/table action contracts at definition time.

See [plugin admin](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-admin.md)
and [scheduled tasks](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-scheduled-tasks.md).

## License

MIT
