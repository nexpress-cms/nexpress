---
"@nexpress/admin": minor
---

Page edit view gains an "In navigation" side panel that shows which
nav locations currently link to this page and lets the editor add
or remove the page without leaving the page form. Backed by a new
`GET /api/navigation/membership?pageId=<id>` endpoint that scans
every `np_navigation` row for the current site (recursing into
`children`), so the API stays correct as nav locations grow beyond
the current `header` / `footer` / `main` triplet — no fixed
location list baked into the server.

The "Add to" dropdown still surfaces the three default locations
in v1; when nav locations become user-defined, switch the panel's
location source to a `/api/navigation/locations` fetch and the
membership endpoint already speaks the right shape.
