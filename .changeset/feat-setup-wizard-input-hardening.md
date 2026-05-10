---
"create-nexpress": patch
---

**Setup wizard: stricter input validation (#618).**

`pnpm run setup` now catches malformed inputs before writing
`.env`, instead of letting the operator's first `pnpm db:migrate`
or `pnpm dev` discover them at runtime.

New checks in `validateBody`:

- **DATABASE_URL** — beyond the `postgres://` prefix regex,
  `new URL()` parsing now confirms the host portion is present.
  Catches shapes like `postgres://` (no host) or
  `postgres://[malformed` that the regex previously accepted.
- **NP_SECRET** — adds a low-entropy floor (≥8 distinct
  characters). The form's `generate` button produces a real
  64-char random hex; this catches an operator who overwrites
  it with `"a".repeat(32)` or similar.
- **SITE_URL** — same URL-parser hardening as DATABASE_URL.
  Catches `https://` (no host) and malformed shapes the regex
  passed through. Affects #597 (boot-time SITE_URL warning)
  and #598 (host-injection guard) — both rely on a parseable
  base URL.
- **S3 endpoint (when supplied)** — must parse as a URL with
  a host portion. Catches typos before AWS / MinIO calls fail
  with cryptic SDK errors.

Both copies of `setup-server.ts` (the reference app's
`apps/web/scripts/` and `create-nexpress`'s
`packages/cli/templates/scripts/`) are updated together.

`validateBody` is now exported so the unit suite can pin the
contract — 20 new tests in
`apps/web/tests/setup-validate.unit.test.ts` cover the happy
path, every reject branch, and the runMigrate default.
