---
"@nexpress/app": patch
"@nexpress/cli": patch
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/plugin-sdk": patch
"@nexpress/plugin-block-callout": patch
"@nexpress/plugin-forum": patch
"@nexpress/plugin-oauth-github": patch
"@nexpress/plugin-oauth-google": patch
"@nexpress/plugin-reading-time": patch
"@nexpress/plugin-seo-audit": patch
---

Complete the remaining plugin definition contracts: validate page templates,
ICU translations, config schema/version/migrations, and lifecycle callbacks;
run teardown and clean every source-owned contribution during reload or failed
setup; expose template/translation inventories and conflicts in plugin doctor;
remove the never-implemented custom-field registry; and align scaffolds,
bundled examples, and author documentation.
