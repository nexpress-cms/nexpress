# @nexpress/cli

Project-side `nexpress` CLI for plugins, themes, deployment planning,
operations, release handoffs, runbooks, and extension scaffolding.

Projects created by `create-nexpress` install this package automatically.
Custom hosts can add it directly:

```bash
pnpm add -D @nexpress/cli
pnpm exec nexpress --help
```

## Main command groups

- `nexpress plugin add|remove`
- `nexpress theme add|remove`
- `nexpress deploy plan`
- `nexpress ops status|contracts|doctor|preflight|health`
- `nexpress ops backup|jobs|migrate|storage|plugins`
- `nexpress release check|plan|apply|verify`
- `nexpress runbook <name>`
- `nexpress create block-plugin|hook-plugin|route-plugin|page-plugin|admin-plugin|scheduled-plugin|theme`

Mutation commands expose dry-run or explicit approval gates where applicable.
Machine-facing workflows support stable `--json` and compact `--brief` output.

## Links

- [Agent-operated ops](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-operated-ops.md)
- [Plugin quickstart](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-quickstart.md)
- [Deployment](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md)

## License

MIT
