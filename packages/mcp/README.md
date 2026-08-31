# @nexpress/mcp

Port-free Model Context Protocol transports for the
[NexPress](https://github.com/nexpress-cms/nexpress) Agent Gateway.

The first transport uses stdin/stdout and the maintained official TypeScript
SDK v1 release `1.30.0`. It negotiates MCP `2025-11-25`, opens no TCP listener,
authenticates an exposure-bound `npst1` service credential before reading
input, and limits both inbound and outbound protocol frames to 5 MiB.

## Install

```bash
pnpm add @nexpress/mcp
```

Applications normally use the shared `@nexpress/app` process runner and a thin
host wrapper rather than constructing the transport directly. The checked-in
reference app and fresh `create-nexpress` projects expose that wrapper as:

```bash
pnpm run agent:mcp
```

Local MCP remains unavailable until the host explicitly installs the Agent
Studio Gateway runtime, enables `agents.gateway.stdio`, and supplies the
one-time service credential to the child process through
`NP_AGENT_SERVICE_TOKEN`. The token determines the site; there is no caller
site selector. Keep credentials out of project files, command-line flags,
checked-in `.env` files, logs, and shell history.

AP-204 intentionally advertises no tools, resources, prompts, or tasks. The
bounded capability projection is owned by the later AP-206 slice.

See the [Agent Gateway guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-gateway.md)
for host wiring, credential handling, lifecycle, and compatibility details.

## License

MIT
