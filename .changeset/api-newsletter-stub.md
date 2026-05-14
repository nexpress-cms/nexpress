---
"@nexpress/app": patch
---

Add `/api/newsletter` framework stub.

Themes ship a footer subscribe form that POSTs `{ email }` to
`/api/newsletter`. Before this change the route existed in no
package, so the form's success path always hit a 404 and rendered
"Newsletter endpoint not configured." — operator UX was "open
the file and write something" before the form's golden path
worked at all.

The new stub:

- Lives at `@nexpress/app/api/newsletter/route` and is wired into
  `apps/web/src/app/api/newsletter/route.ts` like the other app
  routes.
- Accepts `POST { email: string }`, validates RFC 5321-ish shape
  + 254-char ceiling, and returns `{ subscribed: true }` on
  success. Bad input surfaces a `VALIDATION_ERROR` 400 with the
  per-field message the form already knows how to render.
- Does NOT deliver mail or persist anywhere — it only logs the
  address in dev so an operator notices the stub is wired and
  needs to be replaced with a real provider call (Buttondown,
  ConvertKit, Resend, Mailchimp, …). The route's JSDoc carries
  the replacement recipe.

Production deployments should overwrite the app's route file
with the operator's actual provider integration; the stub stays
shipped from `@nexpress/app` for fresh installs and dev.

Proxy wiring:

- `/api/newsletter` is added to `CSRF_EXEMPT_PATTERNS` in
  `packages/app/src/proxy/index.ts`. Anonymous visitors have no
  `np-csrf` cookie, so gating the submit on CSRF would 403 every
  fresh visitor — same reason `/api/admin/setup` is exempt.
- A dedicated rate-limit rule (5 req/min/IP) is the floor against
  subscribe-spam in lieu of the CSRF gate. Operators with their
  own provider may want to tighten or loosen this in their app
  copy of the proxy.
