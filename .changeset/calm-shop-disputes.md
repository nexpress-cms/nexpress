---
"@nexpress/plugin-shop": patch
"@nexpress/shop-payment-stripe": patch
"create-nexpress": patch
---

Add provider-neutral, authenticated, PII-free payment-dispute evidence with
stable event/dispute identity, exact captured-payment matching, monotonic
status, durable Admin/Doctor diagnostics, order-lifetime cleanup, and
fail-closed fulfillment/refund/exchange provider effects without automatic
commercial compensation. Normalize signed Stripe dispute
created/updated/closed events only after an authoritative PaymentIntent read,
and update Shop and scaffold guidance.
