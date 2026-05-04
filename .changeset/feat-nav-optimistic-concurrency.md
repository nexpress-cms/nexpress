---
"@nexpress/admin": minor
"@nexpress/web": minor
---

`PUT /api/navigation` honors an optional `expectedUpdatedAt`
token. The settings editor and the page-edit "In navigation"
panel both stash the `updatedAt` they got from the GET and echo
it back on the next PUT. If the row's `updatedAt` doesn't match
what the client expected, the route returns a 409 instead of
silently overwriting another writer's save.

The token is opt-in: requests that don't include
`expectedUpdatedAt` keep the previous last-write-wins semantics
for back-compat (server-side scripts, older admin builds, the
"first save of a fresh location" path where there's no row to
compare against yet).

When a 409 lands, both UIs surface a clear "someone else
changed this" message instead of a generic save error.
