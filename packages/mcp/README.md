# @nexpress/mcp

Port-free Model Context Protocol transports for the
[NexPress](https://github.com/nexpress-cms/nexpress) Agent Gateway.

The package uses the maintained official TypeScript SDK v1 release `1.30.0`
and negotiates the frozen MCP `2025-11-25` revision. It provides local
stdin/stdout and same-origin Streamable HTTP adapters without opening a TCP
listener of its own. Both transports authenticate before protocol dispatch and
limit complete inbound and outbound frames to 5 MiB.

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

Remote MCP reuses the application's canonical HTTPS origin at `/api/mcp`; it
does not use a dedicated MCP port. It remains a deliberate `404`, along with
OAuth discovery, until the host installs both the Gateway and OAuth services,
provides a dedicated P-256 ES256 signing-key ring plus token-HMAC key ring, and
enables `agents.gateway.mcpHttp`. Interactive clients use the built-in
Authorization Code + PKCE S256 flow. Public clients and exact redirect URIs
must be registered in Agent Studio; no client secret or dynamic client
registration is supported. Unattended clients may instead use an exact
`mcp-http` service credential.

The package accepts a host-injected AP-206 projection and registers only its
authenticated snapshot. The current core projection maps `site.inspect` and
`content.query` to bounded read tools, exposes site/capability/schema resources,
validates every result against the official SDK schemas, and reduces host
failures to safe protocol errors. Present read tools are inline and reject task
augmentation. Prompts remain absent until their dependent capabilities exist;
task methods are negotiated only when the host injects the durable task
service. The transport package still owns no policy, database, credential, or
automatic runtime factory.

See the [Agent Gateway guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/agent-gateway.md)
for host wiring, credential handling, lifecycle, and compatibility details.

## License

MIT
