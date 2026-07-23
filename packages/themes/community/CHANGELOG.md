# @nexpress/theme-community

## 0.5.0

### Patch Changes

- 32d9d37: Add the independent Korean community portal theme with dense article feeds,
  member surfaces, Korean starter content, responsive navigation, and optional
  forum enhancement through the plugin's public CSS variables and data hooks.
  Register the theme in the default app and fresh scaffold bundle.
- 3969569: Complete the shared public comment experience with exact enriched list windows,
  batched public author and reaction projections, reply trees, owner edit/delete,
  pagination, localized forum copy, and stable theme hooks. Keep all mutations on
  the existing community routes and add exact OpenAPI, integration, model, and
  contract coverage without a new forum-specific schema.
- d4e109e: Add opt-in document reactions and privacy-preserving daily-unique views, one
  bounded batch engagement summary contract, forum list/detail metrics and
  recommendation UI, and a recent-popularity home feed. Include migration,
  OpenAPI, doctor, site cleanup, scaffold, theme hooks, and operator guidance.
- 839f2f9: Add explicit collection-owned public member activity with PII-free profile and
  exact document/comment page contracts, validated API and OpenAPI surfaces,
  prepared theme renderer props, forum opt-in, a complete community-theme view,
  comment anchors, and scaffolded route coverage.

  `GET /api/members/{handle}` now returns the exact profile fields directly;
  clients using the previous `{ member: ... }` wrapper should read those fields
  from the response root.

- Updated dependencies [cace33b]
- Updated dependencies [3969569]
- Updated dependencies [3d6d276]
- Updated dependencies [df355e8]
- Updated dependencies [258a9b7]
- Updated dependencies [1dadf0c]
- Updated dependencies [1909079]
- Updated dependencies [d4e109e]
- Updated dependencies [a5898f2]
- Updated dependencies [1d9ef80]
- Updated dependencies [839f2f9]
- Updated dependencies [7d0f4fb]
- Updated dependencies [66c7f66]
- Updated dependencies [305ba8a]
- Updated dependencies [c6d72b8]
- Updated dependencies [7ec1b9c]
- Updated dependencies [b9d699d]
  - @nexpress/core@0.5.0
  - @nexpress/blocks@0.5.0
  - @nexpress/next@0.5.0
  - @nexpress/theme@0.5.0
  - @nexpress/editor@0.5.0
