# @nexpress/auth-pages

Server route factories for NexPress staff and member authentication, plus
headless React hooks for member-facing auth screens.

## Install

```bash
pnpm add @nexpress/auth-pages
```

## Exports

- `@nexpress/auth-pages/server` exports `createMemberAuthRoutes()` and
  `createStaffAuthRoutes()`. Host apps supply the existing NexPress bootstrap,
  DB accessor, and auth helpers, then re-export the returned handlers from
  their App Router route files.
- `@nexpress/auth-pages/client` exports controlled hooks for member login,
  registration, logout, email verification, forgot-password, and
  reset-password screens. Themes own the JSX while the hooks own request,
  validation-error, and submission state.

The factories use the canonical NexPress auth/session contract: one persisted
row per browser session, refresh rotation, anti-enumeration responses, and
shared API error envelopes.

## Links

- [Authentication contract](https://github.com/nexpress-cms/nexpress/blob/main/docs/authentication.md)
- [Theme and page author cookbook](https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-and-page-authors.md#6-auth)

## License

MIT
