# Agent Gateway

The shipped Agent Gateway foundation has one local MCP transport:
`@nexpress/mcp` over stdin/stdout. It opens no TCP listener, has no MCP port
setting, and does not proxy a local credential to a remote NexPress site.
Remote Streamable HTTP and OAuth are not implemented by this slice.

The transport currently negotiates MCP `2025-11-25`. The protocol has since
published a newer era, but NexPress keeps this revision deliberately because
the R2 capability and task contracts were frozen against it. A protocol-era
upgrade is a separate compatibility change.

## Host requirements

Local MCP is disabled until all of these are true:

1. `agents.gateway.stdio` is explicitly enabled in `nexpress.config.ts` for
   both the deployment and selected site.
2. The server host constructs `createAgentGatewayServiceV1(...)`, installs it
   through `createAgentStudioServerRuntimeV1({ gateway })`, and passes that
   runtime to `createBootstrap({ agentStudioRuntime })`. Token HMAC keys and
   other server-only material stay in this host seam; NexPress does not invent
   them from client-safe config.
3. An operator creates an external principal and a `stdio` service credential
   in Agent Studio. The token is displayed once, stored only as a keyed hash,
   site-bound, audience-bound to `urn:nexpress:agent-gateway:stdio`, and has an
   immutable `read`, `propose`, or `approved-execute` ceiling. Creation
   defaults to `read`.

The checked-in reference app and a fresh scaffold keep every Gateway transport
disabled and install no automatic runtime factory.

## Run locally

Give the one-time value to the child process as `NP_AGENT_SERVICE_TOKEN`.
Avoid a command-line flag, generated config, checked-in `.env`, or shell
history. One interactive option is:

```bash
read -rsp "NexPress Agent service token: " NP_AGENT_SERVICE_TOKEN
export NP_AGENT_SERVICE_TOKEN
pnpm run agent:mcp
unset NP_AGENT_SERVICE_TOKEN
```

An MCP client normally spawns that command and supplies the environment from
its secret store. The credential determines the site; `NP_AGENT_SITE_ID` is
ignored and cannot override it. `stdout` is reserved for MCP JSON-RPC frames.
Stable diagnostic codes go to `stderr` without credentials, frames, database
details, or internal errors.

The adapter authenticates before reading stdin and uses the normal project
`ensureFor("read")` bootstrap. EOF, SIGINT, SIGTERM, startup failure, and
protocol close all run terminal bootstrap shutdown. Inbound frames are capped
at 5 MiB, and an oversized outbound frame closes the transport before any part
of that frame reaches `stdout`.

## Current protocol surface

AP-204 is the transport and authentication slice. It advertises an honest
empty capability object today. AP-206 will project the bounded tools,
resources, prompts, and negotiated durable tasks through the existing shared
capability admission service. Local execution never bypasses live principal,
staff authority, scope, exposure, policy, audit, idempotency, approval, or
quota checks.
