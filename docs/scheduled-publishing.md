# Scheduled publishing

NexPress lets editors pick a future `publishedAt` on any document in a
collection that supports the `published` status. The public site only
renders documents with `status="published"`, so scheduled posts stay
hidden until the pipeline flips them live.

---

## How scheduling flows

1. An editor saves a document with `_status: "scheduled"` and a
   future `publishedAt` timestamp. Older API clients may still send
   `_status: "published"` plus a future `publishedAt`; the pipeline
   keeps that compatibility path.
2. The write pipeline (`packages/core/src/collections/pipeline.ts`)
   automatically demotes the status to `"scheduled"` before persisting —
   the public site never sees the post ahead of time.
3. A background sweep (`publishScheduledDocuments`) queries for rows
   where `status="scheduled"` and `publishedAt <= now()`, flips them to
   `"published"`, and fires `content:afterUpdate` + `content:afterPublish`
   hooks so plugins (SEO, caches, notifications) react as if the post had
   just gone live interactively. The HTTP trigger also calls the app's
   collection revalidator for every promoted row, so public pages,
   sitemap, feed, search, and cached theme routes do not wait for their
   TTL before seeing the new content.

The `scheduled` status is a first-class document status. Public reads,
search, sitemap, and feed generation still treat only
`status="published"` as live.

---

## Running the sweep

The sweep isn't automatic inside the web process — it's exposed as an
HTTP trigger so you can drive it from whatever scheduler your host
provides. One endpoint, Bearer-token protected:

```
POST /api/internal/publish-scheduled
Authorization: Bearer <NP_SCHEDULER_TOKEN>
```

Response body:

```json
{
  "published": 3,
  "byCollection": {
    "posts": ["01JZ0..."],
    "pages": []
  },
  "at": "2026-04-24T12:00:00.000Z"
}
```

Idempotent and cheap. Call it every minute or two from:

- **Vercel Cron**: add an entry to `vercel.json`'s `crons` array.
- **Fly.io / Render**: use their built-in scheduler or a separate
  `supercronic`-backed container.
- **Self-hosted**: `systemd` timer, Kubernetes `CronJob`, or plain
  `crontab` piping to `curl`.

Set `NP_SCHEDULER_TOKEN` to a long random string in the environment
before enabling cron — when the env var is unset the endpoint refuses
every request so production deploys can't accidentally leave it open.

---

## Using it from the admin

The collection edit view ships a **Schedule** button next to **Publish**.
It opens a date/time picker that submits the document with
`_status: "scheduled"` plus a future `publishedAt`. The API also accepts
the older `_status: "published"` plus future `publishedAt` shape and
demotes it server-side, so existing integrations keep working.

The same edit view's **Preview** button enters draft mode through
`/api/preview` and redirects to the collection's configured
`seo.urlPath(doc)` value. New documents and dirty forms use **Save Draft
& Preview**, **Save & Preview**, **Save Scheduled & Preview**, or
**Publish & Preview** first (depending on the document status); after the save, the admin asks
`/api/admin/collections/{slug}/{id}/preview` for the server-resolved
preview href. That keeps admin preview aligned with the real public
route: i18n pages preview at `/<locale>/<slug>`, posts at
`/blog/<slug>`, and theme-contributed post kinds follow their own
`urlPattern`.

When the document is already scheduled, the button reads **Reschedule**
and the dialog gains a **Cancel schedule** action that switches the doc
back to `draft` (and clears `publishedAt`). The header **Publish**
button also relabels to **Publish now** so editors can ship the
in-flight schedule immediately.

The collection list has a status filter. Use **Scheduled** to audit
pending publishes without mixing them into normal draft or published
queues.

## Using it from an agent

Agents usually care about two operations:

### Schedule a publish

```ts
await fetch(`/api/collections/posts/${id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
  body: JSON.stringify({
    _status: "scheduled",
    publishedAt: "2026-05-01T09:00:00.000Z",
  }),
});
```

The response will show `status: "scheduled"`. Sending
`_status: "published"` with the same future timestamp produces the same
persisted status for compatibility with older agents.

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

## Autosave

Long-form editing benefits from a recovery snapshot in case the
browser crashes mid-edit. Opt in per-collection:

```ts
defineCollection({
  // ...
  versions: { drafts: { autosave: true, autosaveInterval: 5_000 }, max: 50 },
});
```

When `versions.drafts.autosave === true`:

- The admin edit view watches form changes via react-hook-form, debounces
  by `autosaveInterval` (default 5s), and POSTs the in-flight payload to
  `POST /api/collections/{slug}/{id}/autosave`.
- The endpoint writes a row into `np_revisions` with `status="autosave"`
  **without** touching the main document table. The doc's `status` and
  `updatedAt` stay untouched, so plugins hooking on writes don't fire on
  every keystroke.
- Identical consecutive snapshots dedup at the server: the response
  carries `reused: true` and reuses the previous revision's id/version.
- Autosave revisions count toward `versions.max` and rotate out the
  oldest revisions (drafts + published + autosave) when the cap is hit.
- When the latest autosave is newer than the saved document and differs
  from the saved form defaults, the admin edit view shows an **Autosave
  recovery available** banner. Operators can review the changed fields,
  recover the snapshot into the form, or dismiss that autosave for the
  current browser session.

Recovering from the banner does **not** immediately write the main
document row. It loads the autosave into the form as unsaved state, then
the normal manual save or the next autosave loop persists the operator's
decision. The revisions panel still surfaces autosave entries with a
distinct chip; restoring one writes a new draft revision via the normal
restore path.

The header shows a small **Autosaved 12s ago** label; transitions to
**Autosaving…** while a request is in flight and **Autosave error: …**
if the request fails (most often a 401 after the session cookie expires).

## Status taxonomy

| `_status` sent                       | `status` persisted | Notes                            |
| ------------------------------------ | ------------------ | -------------------------------- |
| `"draft"`                            | `"draft"`          | Hidden from public site.         |
| `"published"` + past `publishedAt`   | `"published"`      | Public.                          |
| `"published"` + future `publishedAt` | `"scheduled"`      | Pipeline auto-demotes.           |
| `"scheduled"`                        | `"scheduled"`      | Accepted as-is.                  |
| `"archived"`                         | `"archived"`       | Hidden but retained for restore. |

The public renderer filters to `status="published"`. Revisions keep the
full history regardless of status.
