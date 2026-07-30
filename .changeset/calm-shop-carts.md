---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/plugin-shop": patch
"@nexpress/plugin-sdk": patch
"@nexpress/theme-storefront": patch
"create-nexpress": patch
---

Add bounded site-owned Shop carts for guests and members, including signed
guest identity, revision-safe mutations, live product/variant quotes, cart
skins, Admin health and cleanup, an hourly expiry task, and member identity on
plugin API route requests. Checkout, payment, orders, and inventory reservation
remain explicitly outside the contract.
