# Agent Gateway

The shipped Agent Gateway has two port-free MCP transports:

- local `@nexpress/mcp` over stdin/stdout;
- optional same-origin Streamable HTTP at `POST /api/mcp`.

Neither adapter opens a TCP listener or defines an MCP port setting. Remote
MCP reuses the application's canonical HTTPS origin and normal ingress. The
stdio adapter does not proxy its local credential to a remote NexPress site.

The transport currently negotiates MCP `2025-11-25`. The protocol has since
published a newer era, but NexPress keeps this revision deliberately because
the R2 capability and task contracts were frozen against it. A protocol-era
upgrade is a separate compatibility change.

## Host requirements

All Gateway transports are disabled by default. Local MCP requires all of the
following:

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

Remote MCP additionally requires the host to:

1. enable `agents.gateway.mcpHttp` in deployment config and in the selected
   site's Gateway setting;
2. configure one canonical HTTPS site origin, never a separate port or relay;
3. construct `createAgentOauthServiceV1(...)` with the existing Gateway,
   dedicated token-HMAC keys, and a dedicated ES256 P-256 signing key ring;
4. install both services with
   `createAgentStudioServerRuntimeV1({ gateway, oauth })`;
5. pre-register each public client and its exact HTTPS or explicit loopback
   HTTP redirect URIs in Agent Studio.

The OAuth signing key is distinct from `NP_SECRET`, provider credentials, and
Vault keys. Keep its private material server-only. Publish only the active and
explicitly retiring public keys through the built-in JWKS endpoint. Client
secrets and Dynamic Client Registration are not accepted in v1.

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

## Connect remotely

The authoritative MCP resource is the canonical URL:

```text
https://<site-host>/api/mcp
```

Interactive clients discover the built-in authorization server through:

```text
/.well-known/oauth-protected-resource/api/mcp
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
```

The flow uses Authorization Code with PKCE `S256`, exact redirect matching,
the exact MCP `resource` indicator, short-lived ES256 access tokens, rotating
hash-only refresh tokens, and one staff-authenticated, CSRF-protected consent.
An administrator must first register the public client in Agent Studio. The
consenting staff user may narrow scopes and Gateway mode but cannot exceed the
deployment, site, client, or live staff-authority ceilings.

Unattended clients may use a separately issued `npst1` service credential only
when its transport and audience are exactly `mcp-http` and the canonical MCP
resource. Stdio credentials, browser sessions, provider keys, OAuth tokens from
another issuer, query parameters, and cookies are not accepted.

Remote v1 is stateless and JSON-response-only: clients must advertise both
`application/json` and `text/event-stream`; GET and DELETE return `405`, no
`MCP-Session-Id` is issued, and non-initialize requests must send
`MCP-Protocol-Version: 2025-11-25`. Foreign `Origin` or host values fail before
protocol parsing. A missing Origin is permitted only after header-borne Agent
Gateway authentication.

If deployment intent, site intent, canonical origin, runtime services, or
signing keys are absent, `/api/mcp` and every related discovery endpoint return
the same deliberate `404`.

## Current protocol surface

AP-204 and AP-205 are the transport and authentication slices. They advertise
an honest empty capability object today. AP-206 will project the bounded tools,
resources, prompts, and negotiated durable tasks through the existing shared
capability admission service. Local execution never bypasses live principal,
staff authority, scope, exposure, policy, audit, idempotency, approval, or
quota checks.
