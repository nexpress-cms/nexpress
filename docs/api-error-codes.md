# API error codes

Every error response from the framework's REST surface follows a uniform
envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{ "field": "email", "message": "must be a valid email" }]
  },
  "status": 400
}
```

The `code` field is **the stable, machine-readable identifier** clients
should branch on. Error messages are display-only and may change between
patch releases; codes follow semver.

## Stability guarantee

- **Renames or removals** of an existing code are **major-bump only**
  (e.g. v1 → v2). Existing clients stay green across minor and patch
  releases.
- **New codes** may land in **minor releases**. Clients must handle
  unknown codes (typically by surfacing the `message` and falling back
  to a generic UI).
- **Status code → error code mapping** is also stable. A given code
  always carries the same HTTP status across releases.

The TypeScript union `NxErrorCode` (exported from `@nexpress/core`) is
the canonical source of truth — adding a new code requires extending
the union, which makes the addition visible in code review.

## Catalogue

| Code | HTTP | Thrown by | Meaning |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | `NxValidationError`, Zod validators | Request shape was malformed. `details` carries field-level errors. |
| `INVALID_URL` | 400 | Plugin `ctx.http.fetch` | Plugin tried to fetch a URL that wouldn't parse. |
| `UNAUTHORIZED` | 401 | `NxAuthError` | Caller is not authenticated (no/invalid session). |
| `FORBIDDEN` | 403 | `NxForbiddenError` | Caller is authenticated but lacks the required role/capability. |
| `NOT_FOUND` | 404 | `NxNotFoundError` | Document / resource doesn't exist. |
| `CONFLICT` | 409 | `NxConflictError`, `ctx.media.delete` with refs | Conflicting state — typically uniqueness or referential integrity. |
| `RATE_LIMITED` | 429 | `NxRateLimitError`, member quota | Per-actor quota or rate limit exceeded. |
| `TOO_MANY_REQUESTS` | 429 | Login lockout | Distinct from `RATE_LIMITED` so client UIs can differentiate "wait a bit" vs. "your account is locked." |
| `SITE_CONTEXT_MISSING` | 500 | `requireSiteId()` on writes (#272) | Server-side wiring bug — no site resolver was set on a write path. Clients shouldn't see this in healthy production. |
| `EMAIL_ADAPTER_MISSING_DEPENDENCY` | 500 | SMTP adapter | Operator configured `NX_EMAIL_ADAPTER=smtp` but the `nodemailer` package isn't installed. |
| `EMAIL_DELIVERY_FAILED` | 502 | SMTP adapter | Outbound SMTP rejected the message. |
| `INTERNAL_ERROR` | 500 | Catch-all in `nxErrorResponse` | An unexpected error reached the API layer. Body contains no stack trace; check server logs. |

## Notes for client integrations

- Always handle unknown codes gracefully. New codes appear in minor
  releases — your client should fall through to the `message` and
  generic error UI rather than fail closed.
- Rely on `code`, not `message`. Localised UI translations should map
  from code → translation key.
- The `details` field is present on `VALIDATION_ERROR` (and any future
  code that documents it). Don't assume its presence on other codes.

## For framework contributors

Adding a new error code:

1. Extend the `NxErrorCode` union in `packages/core/src/errors.ts`.
2. Throw it via `new NxError(message, "YOUR_CODE", status)` or a new
   subclass (recommended for codes thrown from many sites).
3. Update this doc's catalogue.
4. The change is a minor release bump.

Renaming or removing a code:

1. Treat as a breaking change → major release bump.
2. Update CHANGELOG with explicit migration notes for clients.
3. Coordinate with downstream client teams.
