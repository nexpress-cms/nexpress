---
"@nexpress/plugin-shop": patch
"@nexpress/shop-payment-toss": patch
"create-nexpress": patch
---

Add provider-neutral cumulative payment-adjustment events that reconcile known
refunds, safely compensate unknown single full reversals, block ambiguous
partial adjustments, and expose exact Toss, Admin, Doctor, scaffold, and
PostgreSQL coverage.
