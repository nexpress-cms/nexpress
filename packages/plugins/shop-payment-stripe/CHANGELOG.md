# @nexpress/shop-payment-stripe

## 0.4.4

### Patch Changes

- @nexpress/plugin-shop@0.4.4

## 0.4.3

### Patch Changes

- e116046: Add provider-neutral, authenticated, PII-free payment-dispute evidence with
  stable event/dispute identity, exact captured-payment matching, monotonic
  status, durable Admin/Doctor diagnostics, order-lifetime cleanup, and
  fail-closed fulfillment/refund/exchange provider effects without automatic
  commercial compensation. Normalize signed Stripe dispute
  created/updated/closed events only after an authoritative PaymentIntent read,
  and update Shop and scaffold guidance.
- 471fa8a: Extend the bundled Stripe adapter with exact received-return partial refunds
  and quote-backed merchant/customer return-postage settlement. Preserve the
  durable Shop refund UUID through Stripe idempotency and PII-free metadata,
  reconcile late retries through one bounded PaymentIntent refund-list read, and
  document and scaffold the expanded opt-in capability.
- e5489bb: Add the first-party Stripe PaymentIntent adapter with a Payment Element launcher, exact server-side confirmation, raw-body webhook signature verification, stable idempotent full refunds, and cumulative successful-refund reconciliation. Document and scaffold the opt-in Stripe keys without enabling payment by default.
- Updated dependencies [ae2cd03]
- Updated dependencies [5560f00]
- Updated dependencies [ecfc274]
- Updated dependencies [b2121ee]
- Updated dependencies [5e01252]
- Updated dependencies [9c0fc98]
- Updated dependencies [1ceb0bf]
- Updated dependencies [ae21784]
- Updated dependencies [b867ddc]
- Updated dependencies [5197814]
- Updated dependencies [1b34745]
- Updated dependencies [e116046]
- Updated dependencies [9cb5a22]
- Updated dependencies [0756a3b]
- Updated dependencies [559fb31]
- Updated dependencies [99a523b]
- Updated dependencies [79d8f1d]
- Updated dependencies [824d6e9]
- Updated dependencies [36efdb0]
- Updated dependencies [493ae13]
- Updated dependencies [a487b2f]
- Updated dependencies [25f8112]
- Updated dependencies [33d4c85]
- Updated dependencies [6857add]
- Updated dependencies [ebd0422]
- Updated dependencies [44cb5e7]
- Updated dependencies [772f58b]
- Updated dependencies [d5ebd9b]
- Updated dependencies [ef03370]
- Updated dependencies [9470eee]
- Updated dependencies [b0b6c91]
- Updated dependencies [6b8cd26]
- Updated dependencies [089f584]
- Updated dependencies [e2b1197]
- Updated dependencies [7088ce6]
- Updated dependencies [4943aa2]
- Updated dependencies [c7fbd4c]
- Updated dependencies [8250b4b]
- Updated dependencies [9414257]
- Updated dependencies [f40a639]
- Updated dependencies [a1a57a0]
- Updated dependencies [909c42f]
- Updated dependencies [2a700c3]
- Updated dependencies [d38d7d0]
- Updated dependencies [190bd9c]
- Updated dependencies [471fa8a]
- Updated dependencies [e5489bb]
- Updated dependencies [d39f368]
- Updated dependencies [cc2bc2c]
- Updated dependencies [e116046]
- Updated dependencies [9e23204]
  - @nexpress/plugin-shop@0.4.3
