# API error contract

Every framework-generated JSON error on the REST surface uses one exact
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

The client-safe `@nexpress/core/api-contract` subpath exports `NpApiError`,
the known `NpErrorCode` inventory, `npErrorStatusByCode`, limits, analyzers,
type guards, and require/create helpers. `@nexpress/next` re-exports the
`NpApiError` type and owns `npErrorResponse()`, which validates the envelope
before serializing it. A malformed code, message, status mapping, or detail
value fails closed to the opaque `INTERNAL_ERROR` response and reaches the
configured logger and error reporter.

Health/readiness probes, redirects, HTML previews, file downloads, and the
OpenAPI document are successful non-envelope response formats. Errors emitted
by the deployment platform before a route or proxy handler runs are also
outside this application contract.

## Exact shape and limits

- The root object contains only `error` and `status`; `error` contains only
  `code`, `message`, and optional `details`.
- Known framework codes have one fixed HTTP status. Extension codes use the
  uppercase pattern `[A-Z][A-Z0-9_]{0,63}` and an integer `400`–`599` status.
- Messages are trimmed, safe text of at most 2,000 characters.
- `VALIDATION_ERROR.details` is required and is a non-empty, bounded array of
  exact `{ field, message }` objects. Zod paths are normalized to dotted field
  names before the response is emitted.
- Other `details` values must be bounded JSON. Functions, symbols, accessors,
  non-finite numbers, class instances, excessive depth, and oversized arrays,
  objects, keys, or strings are rejected.
- Unexpected errors never expose their message or stack to the client.

The generated OpenAPI 3.1 document publishes the same recursive detail schema,
known code/status conditions, reusable `api_error` response, and a fallback
error response on every documented operation. Declared `4xx`/`5xx` responses
reference the same envelope.

## Stability guarantee

- Renaming/removing a known code or changing its HTTP status is breaking and
  requires the repository's pre-1.0 migration/version policy.
- New known codes are additive. Clients must still handle safe extension or
  future framework codes by showing `message` or a generic fallback.
- Messages are display text and may change in patch releases. Branch on
  `code`, never on `message`.

## Catalogue

| Code                               | HTTP | Typical source                       | Meaning                                                                  |
| ---------------------------------- | ---: | ------------------------------------ | ------------------------------------------------------------------------ |
| `VALIDATION_ERROR`                 |  400 | `NpValidationError`, Zod validators  | Request shape or value was invalid. Exact field issues are in `details`. |
| `INVALID_URL`                      |  400 | Plugin `ctx.http.fetch`              | A plugin supplied an invalid outbound URL.                               |
| `UNAUTHORIZED`                     |  401 | `NpAuthError`                        | No valid staff/member/internal authentication was supplied.              |
| `FORBIDDEN`                        |  403 | `NpForbiddenError`                   | The authenticated actor lacks the required capability.                   |
| `CSRF_INVALID`                     |  403 | API proxy                            | A state-changing browser request failed CSRF validation.                 |
| `NOT_FOUND`                        |  404 | `NpNotFoundError`                    | The requested resource or active plugin route does not exist.            |
| `METHOD_NOT_ALLOWED`               |  405 | Plugin route host                    | The plugin route does not accept the request method.                     |
| `CONFLICT`                         |  409 | `NpConflictError`                    | Current state conflicts with the operation, such as referenced media.    |
| `RATE_LIMITED`                     |  429 | Proxy or `NpRateLimitError`          | A request/actor quota was exceeded.                                      |
| `TOO_MANY_REQUESTS`                |  429 | Login lockout                        | Authentication attempts are temporarily locked.                          |
| `EMAIL_ADAPTER_MISSING_DEPENDENCY` |  500 | SMTP adapter                         | SMTP was configured without its optional runtime dependency.             |
| `SITE_CONTEXT_MISSING`             |  500 | Site-scoped write                    | Framework host wiring failed to resolve a site.                          |
| `INTERNAL_ERROR`                   |  500 | Error boundary                       | An unexpected or malformed error reached the API boundary.               |
| `EMAIL_DELIVERY_FAILED`            |  502 | SMTP adapter                         | The configured SMTP service rejected delivery.                           |
| `SERVICE_UNAVAILABLE`              |  503 | Internal triggers/background imports | Required runtime configuration or infrastructure is unavailable.         |

## Framework and plugin authors

Framework code should use an existing `NpError` subclass. Repeated semantics
get a dedicated class such as `NpServiceUnavailableError`; one-off safe
extension codes may use `new NpError(message, code, status, details)`.
`npErrorResponse()` accepts an optional response init for headers, but always
uses the validated status from the envelope.

When adding a known framework code:

1. Add it and its one status to `packages/core/src/api-contract/types.ts`.
2. Add or reuse an `NpError` subclass in `packages/core/src/errors.ts`.
3. Update this catalogue and relevant OpenAPI route descriptions.
4. Add contract/response tests and a changeset.

Plugin extension codes are intentionally not added to `NpErrorCode`. Keep them
stable inside the plugin, follow the uppercase grammar, and document their
status/details alongside the plugin route or action.
