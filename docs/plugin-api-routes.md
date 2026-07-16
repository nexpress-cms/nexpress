# Plugin API routes

Plugin API routes give a plugin a namespaced HTTP surface without adding an
application route by hand. Declare them in `definePlugin({ routes: [...] })`;
NexPress mounts each route at:

```text
/api/plugins/<plugin-id><route-path>
```

For example, plugin `my-plugin` with path `/health` owns
`/api/plugins/my-plugin/health`. Different plugin ids may use the same
method/path pair because the plugin id is part of the URL.

## Define a route

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My plugin",
    description: "Adds a health endpoint.",
    author: { name: "Me" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  routes: [
    {
      method: "GET",
      path: "/health",
      auth: false,
      description: "Report plugin health.",
      handler: (_request, ctx) => ({
        status: 200,
        body: { ok: true, pluginId: ctx.pluginId },
      }),
    },
  ],
});
```

Declaring at least one route auto-adds `api:route` to the resolved manifest.
Capabilities used inside the handler, such as `storage:kv`, `content:read`, or
`network:fetch`, remain explicit.

## Definition contract

Each route has these fields:

| Field         | Contract                                                               |
| ------------- | ---------------------------------------------------------------------- |
| `method`      | One of `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` in uppercase.        |
| `path`        | A static canonical path such as `/health` or `/reports/daily`.         |
| `handler`     | A function returning a route result directly or through a promise.     |
| `description` | Optional non-empty text used by the generated OpenAPI document.        |
| `auth`        | Optional boolean. `true` requires a staff session; default is `false`. |

Paths must start with `/`, contain at least one segment, have no trailing or
empty segments, and be at most 256 characters. Segments may contain ASCII
letters, numbers, `.`, `_`, `~`, and `-`. Dynamic tokens such as `:id`, query
strings, dot segments, and wildcard segments are not supported. Read dynamic
input from `request.query` or `request.body` instead.

A plugin may declare a method/path pair only once. `definePlugin()` rejects
malformed or duplicate definitions during module evaluation. The core host
validates the same contract again so a hand-built object cannot bypass it.
`nexpress ops plugins doctor --json` reports invalid definitions and duplicates
for definitions it can load statically.

## Request contract

The handler receives a request and the normal typed plugin context:

```ts
handler: async (request, ctx) => {
  // request.method: GET | HEAD | POST | PUT | PATCH | DELETE
  // request.path: the declared route path
  // request.params.pluginId: the owning plugin id
  // request.query: flattened string query values
  // request.body: parsed JSON for non-GET/HEAD requests, otherwise undefined
  // request.headers: request headers as a string record
  // request.user: staff summary when the request has a valid session
  return { status: 200, body: { pluginId: ctx.pluginId } };
};
```

`HEAD` automatically dispatches to the matching `GET` registration. The
handler sees `request.method === "HEAD"`, and NexPress removes the response
body before sending it. A route cannot register `HEAD` separately.

JSON request bodies are parsed only when the method can carry a body and the
`Content-Type` includes `application/json`. Repeated query parameters are
flattened to their last value.

## Response contract

Return an object containing an integer HTTP status from 200 through 599:

```ts
return {
  status: 202,
  body: { accepted: true },
  headers: { "x-plugin-job": jobId },
};
```

Only `status`, `body`, and `headers` are accepted. Header names must be
non-empty and values must be strings. Ordinary bodies are JSON-serialized;
an omitted body becomes JSON `null`. Statuses 204, 205, and 304 must not carry
a body. NexPress also emits no body for every `HEAD` request.

The host validates the result before it reaches Next.js. Invalid results and
thrown handler errors use the standard NexPress error adapter. Invalid-result
errors include the plugin id and method/path; unexpected handler failures stay
opaque in production while the server log records their original error and
stack. Intentional `NpError` subclasses keep their documented API code and
message, provided their extension code, status, message, and optional details
pass the shared [`api-contract`](api-error-codes.md). A handler that explicitly
returns a `4xx`/`5xx` route result owns that plugin-specific body shape; it is
not a framework-generated error envelope.

## Authentication and abuse controls

`auth: true` requires a valid staff session and exposes its safe summary as
`request.user`. A public route also receives that summary when the caller
already has a valid session. `auth: false` is public and is appropriate for
webhooks, callbacks, and health endpoints only when the handler supplies any
signature or token checks it needs.

Plugin-defined routes are CSRF-exempt because many are non-browser callbacks.
The framework applies a default 30 requests/minute/IP bucket. That is a floor,
not a complete security policy: public mutating handlers must validate their
own signatures or tokens, and high-volume endpoints need an upstream or
handler-specific limiter.

## Verification

Run the plugin doctor after adding or changing routes:

```bash
pnpm --silent run ops:plugins -- doctor --json
```

The generated `/api/openapi.json` document includes every loaded route, its
description, an automatic `HEAD` operation for each `GET` route, and the
canonical host-error envelope as its fallback response.

See also [`plugin-capabilities.md`](plugin-capabilities.md) for context gates
and [`plugin-manifest.md`](plugin-manifest.md) for definition-level fields.
