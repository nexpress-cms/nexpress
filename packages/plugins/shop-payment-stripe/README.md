# @nexpress/shop-payment-stripe

Stripe PaymentIntent integration for `@nexpress/plugin-shop`. This package is a
Shop payment adapter, not a standalone NexPress plugin. Shop continues to own
orders, inventory, payment attempts, refunds, Admin, and Doctor; this package
owns the Stripe Payment Element handoff, server-authenticated PaymentIntent
confirmation, raw-body webhook signature verification, idempotent full and
received-return refunds, quote-backed return-postage settlement, and
authoritative cumulative successful-refund snapshots.

```ts
import { createShop } from "@nexpress/plugin-shop";
import { stripePaymentsFromEnv } from "@nexpress/shop-payment-stripe";

const shop = createShop({
  payment: {
    adapter: stripePaymentsFromEnv({
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
    }),
  },
});
```

Set `NP_STRIPE_PUBLISHABLE_KEY`, `NP_STRIPE_SECRET_KEY`, and
`NP_STRIPE_WEBHOOK_SECRET` from the same Stripe account and use matching
test/live API-key modes. Only the publishable key and one PaymentIntent client
token reach the browser. The secret API key and webhook endpoint secret remain
server-only.

Register `/api/plugins/shop/payments/webhook` as a Stripe webhook endpoint and
send the unmodified request body. Subscribe to `payment_intent.succeeded`,
`payment_intent.canceled`, `refund.created`, `refund.updated`, and
`charge.refunded`. The adapter verifies every `Stripe-Signature` against the
exact bytes with the five-minute Shop replay window. Unsupported authenticated
events are acknowledged without changing Shop state; invalid, stale, or
mismatched events fail closed.

Preparing a payment creates one automatic-payment-method PaymentIntent using
the Shop attempt UUID as Stripe's `Idempotency-Key`. The intent contains only
the PII-free Shop order and attempt identifiers in metadata. Stripe.js mounts
the Payment Element and confirms it in the browser; a return parameter never
marks an order paid. Shop sends only the PaymentIntent id back to the server,
where this adapter retrieves the intent with the secret key and verifies its
status, metadata, amount, received amount, and currency against the durable
attempt.

Full refunds post the exact Shop amount to `/v1/refunds` with the durable
refund UUID as `Idempotency-Key`. Received-return partial refunds use the same
endpoint and stable UUID after validating Shop's exact item, shipping, and tax
allocation. `refundReturnSettlement` refunds only the positive net amount: a
merchant absorbs the immutable quoted postage, while customer responsibility
deducts exactly that same-currency quote without creating a separate charge.
The partial-refund UUID, order, return, and capability kind are stored as
PII-free Stripe metadata. Before a partial-refund POST, the adapter performs a
bounded `limit=100` PaymentIntent refund read and reconciles an exact matching
UUID, so a late retry remains safe even after Stripe may prune an idempotency
record.

Only a matching `succeeded` refund becomes a Shop provider confirmation.
Pending provider refunds remain retryable, while closed or malformed responses
fail closed. Signed refund deliveries cause a fresh PaymentIntent read and the
same bounded refund-list query. Unique successful refunds are sorted
canonically and must sum to the original amount minus the remaining amount
before Shop receives a cumulative adjustment snapshot.

The adapter intentionally does not initiate repeated or non-return partial
refunds, disputes, subscriptions, invoices, Connect transfers, tax, shipping,
or carrier work. Those remain separate Shop or provider-specific contracts.
