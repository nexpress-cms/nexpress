---
"@nexpress/plugin-shop": patch
"create-nexpress": patch
---

Add transaction-safe Shop inventory reservations for durable pending orders.
Tracked product and variant quantities now subtract active PII-free holds at
the cart and order boundary, concurrent orders serialize by product, and
cancellation or timeout atomically releases reservations. Admin health,
bounded recent rows, docs, scaffold guidance, and Postgres integration
coverage expose the same contract without implying payment or on-hand stock
decrement.
