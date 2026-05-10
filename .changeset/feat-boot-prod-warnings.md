---
"@nexpress/core": minor
---

**Three new boot-time prod warnings (#597).**

`verifyStartupSafety` gains three optional inputs and three new
warning ids that fire when `NODE_ENV=production`:

- `emailAdapterEnv` — when `null` (env var unset) or `"noop"`
  in production, warn that transactional mail (password reset,
  email verify, member digests) is silently dropped. Warning id:
  `noop_email_in_prod`. Note: this checks the operator's
  **intent** via the env var rather than the live adapter,
  because the email adapter is wired AFTER this safety check
  runs in the boot sequence — a live-adapter check would always
  see the default noop. Programmatic `setEmailAdapter()` calls
  surface a false positive; the warning text calls that out.
- `databaseHost` — when loopback (`localhost` / `127.0.0.1` /
  `::1` / `0.0.0.0`) in production, warn that the operator
  likely shipped a stale dev DATABASE_URL. Warning id:
  `loopback_database_in_prod`.
- `siteUrl` — when explicitly `null` (caller checked, env unset)
  warn `missing_site_url`; when loopback-shaped warn
  `loopback_site_url`. Both anchor on broken share links / OAuth
  round-trips / outbound mail links.

The existing input fields are unchanged. Older callers that don't
supply the new fields continue to behave exactly as before — the
new checks treat `undefined` inputs as "caller didn't provide
info, skip the check" rather than firing on every old call site.

`packages/next/src/bootstrap.ts` is updated to gather the three
new inputs from `getEmailAdapter().kind`, the parsed
`DATABASE_URL` host, and `process.env.SITE_URL`. Operators on
nexpress's reference bootstrap get the new warnings automatically.
