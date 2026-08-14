---
"@nexpress/shop-payment-stripe": patch
"@nexpress/plugin-shop": patch
"create-nexpress": patch
---

Extend the bundled Stripe adapter with exact received-return partial refunds
and quote-backed merchant/customer return-postage settlement. Preserve the
durable Shop refund UUID through Stripe idempotency and PII-free metadata,
reconcile late retries through one bounded PaymentIntent refund-list read, and
document and scaffold the expanded opt-in capability.
