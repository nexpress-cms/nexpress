# @nexpress/cli

Project-side `nexpress` CLI for plugins, themes, local feedback reports,
deployment planning, operations, release handoffs, runbooks, and extension
scaffolding.

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
- `nexpress feedback [--json]`
- `nexpress agent connect --client <codex|claude> --transport <stdio|http>`
- `nexpress ops status|contracts|doctor|preflight|health`
- `nexpress ops backup|jobs|migrate|storage|plugins`
- `nexpress release check|plan|apply|verify`
- `nexpress runbook <name>`
- `nexpress create block-plugin|hook-plugin|route-plugin|page-plugin|admin-plugin|scheduled-plugin|theme`

Mutation commands expose dry-run or explicit approval gates where applicable.
Machine-facing workflows support stable `--json` and compact `--brief` output.

`nexpress agent connect` renders a secret-free Codex or Claude Code MCP plan.
With `--apply`, it writes only project-scoped client configuration and the
official NexPress Agent Skill. Stdio forwards `NP_AGENT_SERVICE_TOKEN` from the
client process environment without storing its value. Remote HTTP setup first
prints the exact loopback redirect URI for Agent Studio public-client
registration, then accepts the returned `--client-id` in a second run. The
command does not start clients, approve trust, or grant OAuth consent.

`nexpress feedback` runs the existing read-only Doctor locally and emits only
installed public NexPress package names/versions, bounded runtime identifiers,
and Doctor check IDs/states. Raw environment-variable values, filesystem paths,
database URLs, labels, details, hints, and logs are discarded. The report is
never uploaded; review the Markdown or `np.feedback-report.v1` JSON before
sharing it through the printed issue-form URL.

## Links

- [Agent-operated ops](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-operated-ops.md)
- [Agent Gateway](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-gateway.md)
- [Plugin quickstart](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-quickstart.md)
- [Deployment](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md)

## License

MIT
