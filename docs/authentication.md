# Authentication and session contract

NexPress has two independent authenticated audiences: CMS staff and public-site
members. They share the same fail-closed token and browser-session model, but
use separate database tables, cookie names, and JWT audiences.

The client-safe public contract lives at `@nexpress/core/auth-contract`. It owns
the closed staff-role and member-status inventories, exact API wire types, JWT
claim validators, and persisted session-row validators. Server-side session
operations live at `@nexpress/core/auth`.

## Canonical identities

- Staff roles: `admin`, `editor`, `moderator`, `author`, `viewer`.
- Member statuses: `active`, `pending`, `suspended`, `deleted`, `imported`.
- Only `active` members may create, use, or refresh a session. Every other
  status fails closed.
- Emails stored or exposed through the auth contract are trimmed lowercase
  addresses. IDs and session IDs are UUIDs.
- New passwords contain 8–1024 characters (first-admin setup requires at
  least 12); oversized login candidates are rejected before Argon2 work.
- Invitation, reset, and verification credentials are exact 64-character
  lowercase hexadecimal tokens and are consumed with a database
  compare-and-swap so concurrent replay has one winner.

Admin, OpenAPI, site-membership settings, plugin auth hooks, database enums,
and request validation all consume these same inventories.

## Exact JWT claims

Both access and refresh JWTs contain exactly:

| Claim        | Meaning                                 |
| ------------ | --------------------------------------- |
| `sub`        | Staff user or member UUID               |
| `aud`        | Exactly `staff` or `member`             |
| `ver`        | Current persisted `tokenVersion`        |
| `use`        | Exactly `access` or `refresh`           |
| `sid`        | Browser-session UUID shared by the pair |
| `jti`        | Random per-token identifier             |
| `iat`, `exp` | Integer issue and expiry timestamps     |

Verification pins `HS256`, the expected audience, the expected token purpose,
and the exact claim set. Missing, legacy, aliased, or additional claims are
rejected. Staff and member tokens cannot cross audiences.

`signToken()` and `signMemberToken()` are low-level cryptographic helpers. They
do not create a usable authenticated browser session by themselves. Login,
OAuth, setup, tests, and other session issuers must call
`createStaffSession()` or `createMemberSession()` so the matching database row
exists.

## One row per browser session

`np_sessions` and `np_member_sessions` each store one row per browser session:

- the shared `sid` as the row ID;
- separate SHA-256 access and refresh hashes;
- separate access and refresh expirations;
- bounded user-agent and IP metadata;
- created and updated timestamps.

The lifecycle is:

1. Login or OAuth creates both JWTs and inserts their hashes in one row.
2. An access request verifies the JWT and requires the matching live `sid`,
   subject, access hash, expiry, and current `tokenVersion`.
3. Refresh uses a compare-and-swap update against the old refresh hash. It
   rotates both hashes on the same row, so concurrent use or replay of the old
   refresh token returns `401`.
4. Logout deletes every row named by a valid access or refresh token and its
   shared `sid`, then clears all cookies. Refresh cookies are scoped to the auth
   API prefix so logout remains server-revocable after the access cookie expires.
5. Password change/reset updates the password, bumps `tokenVersion`, and
   deletes every session row for that identity in one transaction. Explicit
   operator invalidation applies the same version/session revocation contract.

## Cookies

| Audience | Access                    | Refresh                              | CSRF                   |
| -------- | ------------------------- | ------------------------------------ | ---------------------- |
| Staff    | `np-session`, path `/`    | `np-refresh`, path `/api/auth`       | `np-csrf`, path `/`    |
| Member   | `np-mb-session`, path `/` | `np-mb-refresh`, path `/api/members` | `np-mb-csrf`, path `/` |

Access and refresh cookies are HTTP-only. Refresh cookies use
`SameSite=Strict`; access and CSRF use `SameSite=Lax`. Production cookies are
secure. State-changing requests still require the matching CSRF header.

## Runtime configuration

- `NP_SECRET`: the only accepted JWT signing secret; runtime and startup safety
  require 32–1024 characters.
- `NP_TOKEN_EXPIRATION`: positive integer seconds, maximum 31 days; default 2
  hours.
- `NP_REFRESH_TOKEN_EXPIRATION`: positive integer seconds, maximum 365 days;
  default 7 days and never shorter than the access lifetime.
- `NP_MAX_LOGIN_ATTEMPTS`: positive integer, maximum 100; default 5.
- `NP_LOCKOUT_DURATION`: positive integer seconds, maximum 30 days; default 15
  minutes.
- `NP_INVITE_TTL_HOURS`: staff-invitation lifetime, maximum 365 days; default
  7 days.
- `NP_RESET_TTL_MINUTES`: staff and member password-reset lifetime, maximum 30
  days; default 1 hour.
- `NP_VERIFY_TTL_HOURS`: member email-verification lifetime, maximum 365 days;
  default 24 hours.
- `NP_OAUTH_STATE_TTL_SECONDS`: OAuth state token and cookie lifetime, maximum
  1 hour; default 10 minutes.

Malformed, fractional, signed, whitespace-padded, scientific-notation, or
out-of-range values abort the auth path instead of silently falling back.
Password-reset, verification, and staff-invitation links additionally require
an explicit `SITE_URL`; credential-bearing email URLs are never derived from a
request `Host` header.

## Migration and diagnosis

Migration `0014_married_skaar` intentionally removes legacy session rows before
adding the paired-token columns. Existing browsers must log in once after that
migration; no legacy refresh credential is inferred.

`pnpm run doctor` includes `auth.contract`. It validates every authentication
runtime setting even without a database, then checks persisted staff and member
projections, both session tables, expiry/hash invariants, and session ownership.
A legacy session schema is reported with the migration command rather than
being treated as current.
