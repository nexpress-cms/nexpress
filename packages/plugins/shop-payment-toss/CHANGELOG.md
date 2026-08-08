# @nexpress/shop-payment-toss

## 0.4.3

### Patch Changes

- ae2cd03: Add provider-neutral cumulative payment-adjustment events that reconcile known
  refunds, safely compensate unknown single full reversals, block ambiguous
  partial adjustments, and expose exact Toss, Admin, Doctor, scaffold, and
  PostgreSQL coverage.
- a487b2f: Add one provider-neutral partial refund contract linked to a received physical
  return, including exact allocation, durable reconciliation, Admin and Doctor
  diagnostics, owner projection, Toss cancellation support, and scaffold guidance.
- 9470eee: Add provider-neutral, owner-scoped Shop payment attempts with bounded public
  handoffs, server-side confirmation, exact stored-order matching, retry-safe
  provider failures, PII-free Admin diagnostics, and the existing atomic
  receipt/inventory transition. Ship the first Toss Payments v2 adapter with KRW
  browser initiation, secret-key idempotent confirmation, query-verified terminal
  webhooks, scaffold guidance, and complete tests and live documentation.
- 9414257: Add durable provider-neutral full refunds with audited Admin actions, resumable provider confirmation, safe inventory compensation, owner and Doctor projections, and exact Toss payment cancellation.
- Updated dependencies [ae2cd03]
- Updated dependencies [5560f00]
- Updated dependencies [b2121ee]
- Updated dependencies [5e01252]
- Updated dependencies [9c0fc98]
- Updated dependencies [b867ddc]
- Updated dependencies [1b34745]
- Updated dependencies [559fb31]
- Updated dependencies [a487b2f]
- Updated dependencies [25f8112]
- Updated dependencies [33d4c85]
- Updated dependencies [44cb5e7]
- Updated dependencies [d5ebd9b]
- Updated dependencies [ef03370]
- Updated dependencies [9470eee]
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
- Updated dependencies [190bd9c]
- Updated dependencies [d39f368]
- Updated dependencies [cc2bc2c]
- Updated dependencies [9e23204]
  - @nexpress/plugin-shop@0.4.3
