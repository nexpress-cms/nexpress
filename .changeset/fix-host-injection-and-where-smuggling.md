---
"@nexpress/auth-pages": patch
"@nexpress/next": patch
---

**Security: fix host-header injection in password-reset / email-verify links + tenant smuggling via `?where=` (#598).**

Two HIGH-severity findings from the security review, both closed at the trust boundary.

### Vuln 1: Host-header injection (password-reset poisoning)

When `SITE_URL` is unset, `siteUrl(config, request)` in
`@nexpress/auth-pages` fell back to `new URL(request.url)`. In
Next.js, an API route's `request.url` is constructed from the
attacker-controlled `Host` header. The `forgotPassword` and
member-`register` flows embedded that base URL as `resetUrl` /
`verifyUrl` in the email-job payload, so an attacker could spoof
`Host: attacker.example` on `POST /api/auth/forgot-password` and
get the framework to mail a real password-reset token inside an
`https://attacker.example/...` URL — full account takeover.

**Fix.** New `siteUrlStrict(config)` helper (in a small
testable `site-url.ts` module) throws when `config.site.url` is
unset — never falls back to `request.url`. Email-link builders
(`buildResetUrl`, `buildVerifyUrl`) call the strict variant.
Same-origin redirects (OAuth callbacks, post-login bounces) keep
using the lenient variant — the Host fallback is safe there
because the user's browser is going back to the same host they
came from.

The `forgotPassword` and `register` route handlers also call
`siteUrlStrict()` upfront, BEFORE any account-existence check,
so the failure mode is uniform for real and fake emails when
`SITE_URL` is unset (avoids a regression where missing config
would leak account existence via differential responses).

8 unit tests in `site-url.test.ts` pin both the lenient and
strict semantics including the Host-injection regression.

### Vuln 2: Tenant + visibility smuggling via `?where=`

`parseWhere` in `@nexpress/next/collections` accepted any JSON
object as the `?where=` query parameter without filtering
reserved keys. The pipeline interprets `where.siteId === "*"`
and `where.visibility === "*"` as trusted-caller sentinels for
admin-side cross-site / cross-visibility queries. With no
caller-side capability check, an anonymous request could send
`GET /api/collections/posts?where={"siteId":"*","visibility":"*","status":"published"}`
to read `visibility=private` posts from sibling tenants on a
multi-tenant deployment.

**Fix.** `parseWhere` now strips the reserved keys (`siteId`,
`visibility`) from user-supplied JSON before forwarding. The
pipeline still honors the wildcards when an INTERNAL caller
passes them programmatically (admin export tools build the
where dict in TypeScript, not from a request); the gate lives
at the trust boundary where it's auditable.

4 new test cases in `collections.test.ts` pin the strip
behavior and confirm non-reserved keys pass through verbatim.
