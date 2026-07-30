---
"@nexpress/app": patch
"@nexpress/plugin-shop": patch
"@nexpress/theme-storefront": patch
"create-nexpress": patch
---

Add exact owner-scoped Shop checkout intents with a fixed 15-minute lifetime,
idempotent and capacity-bounded creation, live cart revalidation, cancellation,
Admin health and cleanup, complete skin fallbacks, independent Storefront
styling hooks, integration coverage, and scaffold guidance. Payment, orders,
customer PII, and inventory reservation remain explicitly outside the contract.
