---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/plugin-shop": patch
"@nexpress/theme-storefront": patch
"create-nexpress": patch
---

Add the first-party Shop catalog and independent Storefront theme, including
bounded product/category collections, exact integer-money and inventory
contracts, public routes, skins, blocks, Admin metrics, scaffold defaults, and
generated migrations. Text fields marked `unique` now receive a site-scoped
database unique index, making product SKU uniqueness race-safe.
