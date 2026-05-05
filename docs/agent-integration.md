# Agent integration guide

NexPress exposes a stable surface for AI agents and automation tools to
discover, read, and write content without bespoke scraping. This guide
covers the three entrypoints an agent needs: the **OpenAPI spec**, the
**auth flow**, and the **plugin discovery API**.

---

## 1. Discover the API surface

`GET /api/openapi.json` returns an OpenAPI 3.1 document rebuilt on every
request (no cache) covering:

- Core auth routes (`/api/auth/login`, `/logout`, `/me`, `/refresh`,
  `/forgot-password`, `/reset-password`, `/change-password`).
- User management (`/api/users`, `/api/users/invite`).
- Every registered collection: `GET|POST /api/collections/{slug}` and
  `GET|PATCH|DELETE /api/collections/{slug}/{id}`.
- Revision history per versioned collection.
- Media (`/api/media`, `/api/media/upload`, `/api/media/{id}`) and folders
  (`/api/media/folders`, `/api/media/folders/{id}`).
- Settings + navigation + theme (`/api/settings`, `/api/settings/theme`,
  `/api/navigation`).
- Plugin management (`/api/plugins`, `/api/plugins/{id}`), plugin action
  dispatch (`POST /api/plugins/{id}/actions/{actionId}`), and every
  plugin-defined route under `/api/plugins/{pluginId}{path}`, tagged with
  `plugin:{pluginId}` so agents can scope to one plugin.
- Import / export (`/api/import`, `/api/export`). Both accept
  `?collections=a,b` to scope to a subset; import also accepts
  `?dryRun=true` to validate a payload without writing.
- Public discovery (`/api/meta/blocks`, `/api/meta/collections`,
  `/api/meta/plugins`) and search (`/api/search`).
- Draft mode entrypoints (`/api/preview`, `/api/preview/exit`) and
  liveness (`/api/health`).

Internal endpoints under `/api/internal/*` (scheduled publish worker,
search reindex) are omitted by design.

The spec is the single source of truth for paths, request/response schemas,
and auth requirements. Agents should fetch it once per session and cache.

---

## 2. Authenticate

All state-changing routes need a session cookie + CSRF header. Read-only
routes (`GET /api/collections/{slug}`, `/api/search`) are public when the
collection's `access.read` allows it.

### Machine-to-machine (recommended for agents)

1. `POST /api/auth/login` with `{ email, password }`.
2. Server sets three cookies: `np-session`, `np-refresh`, `np-csrf`.
3. For every subsequent write, send:
   - `Cookie: np-session=…; np-csrf=…` (your HTTP client does this
     automatically if cookies are enabled).
   - `X-CSRF-Token: <value of np-csrf cookie>` as a header.
4. When the session expires (`401`), call `POST /api/auth/refresh` with
   `Cookie: np-refresh=…` to rotate the session cookie.

Example (Node/undici):

```ts
import { fetch } from "undici";

const login = await fetch("https://site.example/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "bot@example.com", password: process.env.AGENT_PASSWORD }),
});
const cookies = login.headers.getSetCookie();
const csrf = /np-csrf=([^;]+)/.exec(cookies.join(";"))?.[1] ?? "";

await fetch("https://site.example/api/collections/posts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrf,
    Cookie: cookies.join("; "),
  },
  body: JSON.stringify({ title: "Hello", content: { … }, _status: "draft" }),
});
```

### Roles

The JWT carries `role`: one of `admin`, `editor`, `author`, `viewer`.
Endpoints enforce:

- `admin` — user management, plugin CRUD, settings, theme writes.
- `editor` — everything except user/plugin/admin-level settings.
- `author` — own-doc writes via collection `access` callbacks.
- `viewer` — read-only via the admin.

Match the agent's role to its scope (e.g. a content-importer agent =
`editor`).

---

## 3. Read + write content

### List / search

- `GET /api/collections/{slug}?page=1&limit=20&sort=-updatedAt` — paged.
- `GET /api/collections/{slug}?search=query` — uses Postgres full-text
  search over the `search_vector` column. Returned in ts_rank order.
- `GET /api/search?q=query&collections=posts,pages&limit=10` — cross-
  collection search; filters to `status=published` automatically for
  public use.
- `GET /api/collections/{slug}?where=<json>` — JSON-encoded filter
  object. Only equality supported today.

### Create / update

- `POST /api/collections/{slug}` — body is the collection's document
  schema from OpenAPI (`#/components/schemas/{slug}_document`).
- `PATCH /api/collections/{slug}/{id}` — same shape, partial updates.
- `_status` field on the body controls draft/scheduled/published/archived:
  - `"draft"` / `"published"` — as you'd expect.
  - `"scheduled"` — save with a future `publishedAt`; NexPress coerces
    published→scheduled when `publishedAt > now`. See
    [Scheduled publishing](./scheduled-publishing.md) for the sweep
    endpoint and how to wire cron.

### Revisions

If the collection declares `versions.drafts: true`:

- `GET /api/collections/{slug}/{id}/revisions` — paged revision list.
- `GET /api/collections/{slug}/{id}/revisions/{revisionId}` — single
  revision with full snapshot.
- `POST /api/collections/{slug}/{id}/revisions/{revisionId}/restore` —
  rolls back to a prior state (creates a new revision at head).

---

## 4. Discover plugins

- `GET /api/plugins` — admin-only list of installed plugins with:
  - `id`, `name`, `version`, `description`
  - `capabilities` — declared manifest capabilities.
  - `hooks` — hook namespaces this plugin subscribes to.
  - `routes` — plugin-defined HTTP routes mounted under
    `/api/plugins/{id}{path}`.
  - `enabled` / `loaded` flags.
- `GET /api/plugins/{id}` — single plugin's manifest + state.
- `POST /api/plugins/{id}` with `{ enabled, config }` — admin-only.

Plugin routes also appear in the OpenAPI spec with `tags: [plugin:{id}]`
so agents can filter the spec down to a plugin's surface.

### Plugin manifest shape

Every plugin exports a manifest that declares what it can do. The schema
version is tracked via `apiVersion` (currently `"1"`). Notable agent-
friendly fields:

- `agent.description` — one-sentence natural-language summary.
- `agent.category` — one of `seo`, `analytics`, `ecommerce`, `forms`,
  `social`, `media`, `security`, `performance`, `i18n`, `email`,
  `integration`, `content`, `layout`, `navigation`, `utility`.
- `agent.tags` — freeform tags.
- `agent.configSchema` — JSON Schema for the plugin's runtime config.
- `capabilities` — coarse authorization tokens
  (`content:read`, `hooks:content`, `api:route`, `network:fetch`, …).
- `allowedHosts` — external hostnames this plugin can reach via
  `ctx.http.fetch`.

Agents that recommend/install plugins for a site should surface this
metadata to their user for trust review.

---

## 5. Rate limits

Middleware enforces per-IP per-pattern buckets:

| Route prefix             | Limit        |
|--------------------------|--------------|
| `/api/auth/*`            | 10 / min     |
| `/api/media/upload`      | 20 / min     |
| `/api/import`            | 5 / min      |
| `/api/collections/*`     | 100 / min    |
| `/api/plugins*`          | 60 / min     |
| `/api/users*`            | 30 / min     |
| `/api/search*`           | 60 / min     |

When exceeded the response is `429` with a `Retry-After` header.

---

## 6. Error shape

Every error response is:

```json
{ "error": { "code": "…", "message": "…", "details": {} }, "status": 400 }
```

Codes include `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `AUTH_ERROR`,
`CONFLICT`, `RATE_LIMITED`, `INVALID_URL`, `NOT_IMPLEMENTED`. `details`
may carry an array of per-field errors for validation failures.

---

## 7. Stability

- `apiVersion: "1"` on plugin manifests indicates schema v1.
- OpenAPI spec is regenerated from live collection/plugin state — paths
  and schemas follow whatever the project currently declares. Names stay
  stable across minor NexPress versions.
- Breaking changes will bump the manifest `apiVersion` and be noted in
  the changelog.
