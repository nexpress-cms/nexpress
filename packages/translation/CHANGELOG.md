# @nexpress/translation

## 0.5.0

### Patch Changes

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

## 0.4.1

### Patch Changes

- 03d0c2c: Restore installable external package manifests for the translation adapters after their initial 0.4.0 registry bootstrap retained monorepo-only `workspace:*` dependency ranges.
  - @nexpress/blocks@0.4.1
  - @nexpress/core@0.4.1

## 0.4.0

### Patch Changes

- 922c708: Unify collection storage, runtime, generated, Admin, REST, OpenAPI, and
  import/export document shapes behind an exact definition-derived contract.
  Collection reads now hydrate ordered child and hasMany rows, updates preserve
  omitted fields, `_status` is request-only, and malformed persistence or hook
  results fail closed with doctor and live-health diagnostics. Collection
  lifecycle after-hooks now run exactly once with the same hydrated document
  contract as plugin lifecycle hooks.

  Canonical slugs, bounded JSON write values, complete relation inventories, and
  safe unambiguous pagination/locale filters now fail at their earliest runtime
  boundary as part of the same contract.

- 288b5ee: Add Gettext PO content translation round-trips and move XLIFF onto the same
  format-neutral extraction and fail-closed application engine. Atomic strings,
  Lexical text, and schema-declared nested block props now share live source and
  routing validation across both interchange formats. Fresh scaffolds include
  ready-to-run `pnpm gettext` and `pnpm xliff` shims.
- f7ee76e: Promote block content to one stable recursive wire contract. Validate block
  trees before collection writes, pattern storage, Admin JSON/paste/preview,
  translation, and unknown-block operations; expose client-safe validators and
  types; and emit the contract in generated document types and OpenAPI.
- 763ce4a: Promote rich-text content to a stable NexPress-owned v1 envelope. Validate the
  wire format before collection writes; share the type guard, validator, version,
  and empty-document factory through the client-safe fields subpath; and align
  editor state, generated types, SSR, search, media and mention extraction,
  translation interchange, WordPress import, Admin, themes, and example plugins.
- Updated dependencies [bae7088]
- Updated dependencies [257e70f]
- Updated dependencies [7d31c88]
- Updated dependencies [8693411]
- Updated dependencies [3adebdb]
- Updated dependencies [fdcbfd3]
- Updated dependencies [1ff06a7]
- Updated dependencies [922c708]
- Updated dependencies [ab83768]
- Updated dependencies [080fcbf]
- Updated dependencies [257b120]
- Updated dependencies [773bd1a]
- Updated dependencies [21d4748]
- Updated dependencies [c10eb69]
- Updated dependencies [4cef9c8]
- Updated dependencies [a678bb5]
- Updated dependencies [b44257f]
- Updated dependencies [3eb1af7]
- Updated dependencies [27a4f0e]
- Updated dependencies [9eea115]
- Updated dependencies [2e35374]
- Updated dependencies [f3dee13]
- Updated dependencies [ba9f730]
- Updated dependencies [e58c4c8]
- Updated dependencies [f7ee76e]
- Updated dependencies [23c1f69]
- Updated dependencies [fdd684d]
- Updated dependencies [f8ef45e]
- Updated dependencies [cef1583]
- Updated dependencies [3396b1c]
- Updated dependencies [c0a7da6]
- Updated dependencies [bedb705]
- Updated dependencies [91867cc]
- Updated dependencies [3d45e43]
- Updated dependencies [2dce282]
- Updated dependencies [75e6c34]
- Updated dependencies [e0a2092]
- Updated dependencies [8cb026a]
- Updated dependencies [81b3fb5]
- Updated dependencies [f6fa9d1]
- Updated dependencies [5522c32]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
- Updated dependencies [763ce4a]
  - @nexpress/blocks@0.4.0
  - @nexpress/core@0.4.0
