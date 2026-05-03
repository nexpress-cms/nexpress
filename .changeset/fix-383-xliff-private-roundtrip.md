---
"@nexpress/xliff": patch
---

Round-trip private documents through XLIFF export/import (#383).

`exportXliff` and the import-side `findSibling` lookup were both calling
`findDocuments(..., undefined)`, which trips the pipeline's
anonymous-visibility guard (#262) and restricts results to
`visibility = "public"`. Private source rows were therefore omitted from
the export bundle entirely, and private target siblings were invisible to
the import path — leading to skipped translations or duplicate-create
attempts on the second round trip.

`XliffExportOptions` now accepts an optional `user` actor that is threaded
into both `findDocuments` calls inside the export, and `importXliff` passes
its `user` into `findSibling`'s `findDocuments` + `getDocumentById` lookups.
The CLI shim already constructs a synthetic admin user; it now hands that
user to `runExport` as well as `runImport`. Public documents and existing
behavior are unchanged when no operator is supplied.
