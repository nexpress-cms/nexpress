---
"@nexpress/core": patch
---

`group` field's `defaultValue` is now honored at the validation layer. Previously a collection field of the shape

```ts
{
  type: "group",
  name: "seo",
  required: true,
  defaultValue: { metaTitle: "Untitled", metaDescription: "" },
  fields: [
    { type: "text", name: "metaTitle", required: true },
    { type: "text", name: "metaDescription" },
  ],
}
```

silently dropped the default — the group branch in `buildZodSchema` early-returned before `applyFieldDefault` got a chance to wrap the assembled object schema, so API callers omitting `seo` hit a required error even though the framework had a sensible default ready. Scalar / array / select / single-leaf defaults were unaffected; this only bit when a top-level group declared its own object-shaped default.

Wrapping the group branch's schema in `applyFieldDefault` (mirroring the leaf-field path) closes the gap. Test coverage in `collections/validation.test.ts` now spans scalar, group, array, and container-skip cases so the contract is documented by example and a future refactor can't regress this silently.

`row` and `collapsible` containers continue to flatten — they carry no value of their own and their nested fields' defaults are what fire.
