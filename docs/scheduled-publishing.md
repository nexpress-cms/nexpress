# Scheduled publishing

NexPress lets editors pick a future `publishedAt` on any document in a
collection that supports the `published` status. The public site only
renders documents with `status="published"`, so scheduled posts stay
hidden until the pipeline flips them live.

---

## How scheduling flows

1. An editor saves a document with `_status: "published"` and a
   `publishedAt` timestamp in the future.
2. The write pipeline (`packages/core/src/collections/pipeline.ts`)
   automatically demotes the status to `"scheduled"` before persisting —
   the public site never sees the post ahead of time.
3. A background sweep (`publishScheduledDocuments`) queries for rows
   where `status="scheduled"` and `publishedAt <= now()`, flips them to
   `"published"`, and fires `content:afterUpdate` + `content:afterPublish`
   hooks so plugins (SEO, caches, notifications) react as if the post had
   just gone live interactively.

The `scheduled` status is a protocol detail — agents and plugins can
treat any document with `_status: "scheduled"` as "will publish at
`publishedAt`."

---

## Running the sweep

The sweep isn't automatic inside the web process — it's exposed as an
HTTP trigger so you can drive it from whatever scheduler your host
provides. One endpoint, Bearer-token protected:

```
POST /api/internal/publish-scheduled
Authorization: Bearer <NX_SCHEDULER_TOKEN>
```

Response body:

```json
{
  "published": 3,
  "at": "2026-04-24T12:00:00.000Z"
}
```

Idempotent and cheap. Call it every minute or two from:

- **Vercel Cron**: add an entry to `vercel.json`'s `crons` array.
- **Fly.io / Render**: use their built-in scheduler or a separate
  `supercronic`-backed container.
- **Self-hosted**: `systemd` timer, Kubernetes `CronJob`, or plain
  `crontab` piping to `curl`.

Set `NX_SCHEDULER_TOKEN` to a long random string in the environment
before enabling cron — when the env var is unset the endpoint refuses
every request so production deploys can't accidentally leave it open.

---

## Using it from an agent

Agents usually care about two operations:

### Schedule a publish

```ts
await fetch(`/api/collections/posts/${id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
  body: JSON.stringify({
    _status: "published",
    publishedAt: "2026-05-01T09:00:00.000Z",
  }),
});
```

The response will show `status: "scheduled"` because the pipeline
demoted it.

### Cancel a scheduled publish

Either move the timestamp to the past (publishes immediately), or switch
back to `_status: "draft"`:

```ts
await fetch(`/api/collections/posts/${id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
  body: JSON.stringify({ _status: "draft" }),
});
```

---

## Status taxonomy

| `_status` sent | `status` persisted | Notes |
|---|---|---|
| `"draft"` | `"draft"` | Hidden from public site. |
| `"published"` + past `publishedAt` | `"published"` | Public. |
| `"published"` + future `publishedAt` | `"scheduled"` | Pipeline auto-demotes. |
| `"scheduled"` | `"scheduled"` | Accepted as-is. |
| `"archived"` | `"archived"` | Hidden but retained for restore. |

The public renderer filters to `status="published"`. Revisions keep the
full history regardless of status.
