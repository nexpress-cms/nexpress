---
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
"@nexpress/theme-docs": patch
---

fix(core, admin, themes): serializable condition predicates — fixes broken client-side field hiding (9/14)

## The bug

PR 1 (#756) wired `admin.condition` in the admin editor's
`passesCondition` helper, but `packages/next/src/client-safe.ts`
already stripped `admin.condition` from the collection config
before it reached the client component (Next.js can't serialize
functions across the RSC boundary). The browser never saw the
condition function, so the kind-based field hiding **never
worked client-side** — every operator editing any post saw
every field regardless of kind.

Server-side validation (PR 4 #759) was unaffected because the
pipeline uses the original (un-stripped) config.

## Fix

New `NpFieldConditionExpr` discriminated-union type — a
serializable JSON predicate that survives RSC serialization:

```ts
condition: { when: "kind", equals: "doc" }
condition: { when: "kind", notEquals: "doc" }
condition: { when: "kind", in: ["doc", "page"] }
condition: { when: "kind", notIn: ["doc"] }
condition: { when: "wpOriginalAuthor", exists: true }
condition: { all: [...] }                              // AND
condition: { any: [...] }                              // OR
```

`evaluateFieldCondition(condition, data)` (exported from
`@nexpress/core`) handles both the function form (server-only)
and the expression form (works both env), so the admin client +
server pipeline run the same evaluator against the same data.

`admin.condition` type widens to
`NpFieldCondition | NpFieldConditionExpr` — both accepted, but
**the expression form is required for client-side hiding to
work**. Function-form conditions still run server-side (pipeline
validation drops `required` for hidden fields, sitemap walks
honor them) but are silently stripped client-side.

`toClientCollectionConfig` now strips only function-form
conditions; expression-form passes through verbatim.

## Migration of in-tree conditions

All built-in / theme conditions migrate from function form:

- `posts.parent` / `posts.order`: `{ when: "kind", equals: "doc" }`
- `posts.wpOriginalAuthor`: `{ when: "wpOriginalAuthor", exists: true }`
- `theme-magazine.featured`: `{ when: "kind", notEquals: "doc" }`
- `theme-portfolio.*` (9 fields): `{ when: "kind", notEquals: "doc" }`
- `theme-docs.lede` / `stableSince`: `{ when: "kind", equals: "doc" }`

## Edge handling

- **Function condition that throws** → fails open (field visible).
- **Malformed expression** (unknown shape) → fails open.
- **`exists: true`** → false for `undefined`, `null`, `""`, `[]`.
- **`all` / `any`** compose nested expressions for AND / OR logic.

## Tests

`validation.test.ts` adds 9 cases covering function form, every
expression operator, malformed shape, and `collectHiddenFieldNames`
recursing through expression conditions. Core 452 → 461.

## What this unlocks

The kind-based hiding the entire editor sequence (#756-#762) was
designed around now actually works in the browser. Operators
editing `kind="article"` posts won't see docs / portfolio
fields; operators editing `kind="doc"` won't see magazine /
portfolio fields.
