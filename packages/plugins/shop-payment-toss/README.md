# @nexpress/shop-payment-toss

Toss Payments v2 integration for `@nexpress/plugin-shop`. The package exports
an adapter rather than a standalone NexPress plugin: Shop owns orders,
inventory, attempts, and Admin diagnostics, while this package owns the Toss
browser SDK handoff, secret-key confirmation, query-verified webhook
projection, idempotent full-payment cancellation, and one exact partial
cancellation linked to a received physical return, including Shop's optional
quote-backed return-postage responsibility settlement. Query-verified
`CANCELED` and `PARTIAL_CANCELED` webhooks become cumulative provider-neutral
Shop adjustment snapshots rather than being silently ignored.

```ts
import { createShop } from "@nexpress/plugin-shop";
import { tossPaymentsFromEnv } from "@nexpress/shop-payment-toss";

const shop = createShop({
  payment: {
    adapter: tossPaymentsFromEnv({
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
    }),
  },
});
```

Set matching `NP_TOSS_PAYMENTS_CLIENT_KEY` and
`NP_TOSS_PAYMENTS_SECRET_KEY` values from the same test/live mode and key
family (`ck`/`sk` or `gck`/`gsk`). Only the client key reaches the browser.
The current adapter opens the v2 standard card/easy-pay window for KRW orders.
It compares the returned order and amount with the stored Shop attempt before
calling `/v1/payments/confirm` using the secret key and the attempt UUID as the
provider idempotency key. If server confirmation is interrupted, the launcher
keeps the success return parameters and retries that exact attempt instead of
starting another payment.

Register the Shop raw webhook URL
`/api/plugins/shop/payments/webhook` as a Toss
`PAYMENT_STATUS_CHANGED` endpoint. Toss general-payment webhooks are verified
by querying the payment with the secret key; unsupported or mismatched payloads
fail closed, while authenticated non-terminal status updates are acknowledged
without changing the order. Completed cancellation entries must have unique
transaction keys, canonical timestamps, and a total equal to Toss's original
amount minus `balanceAmount`.

Return query parameters never mark an order paid. Only a successful,
server-authenticated confirmation response or a query-verified terminal
webhook can emit the canonical Shop payment event. Ambiguous provider errors
leave the order pending.

When Shop staff choose **Full refund**, the adapter posts to Toss's payment
cancel endpoint with the durable Shop refund UUID as `Idempotency-Key`. It
omits `cancelAmount`, requires a terminal `CANCELED` payment with zero balance,
and returns only the completed cancellation transaction key and timestamp.
Partial cancellation responses fail closed. Shop—not this adapter—then owns
the local order, fulfillment, privacy, inventory-compensation, audit, and
Admin/Doctor transitions.

After Shop has received one physical return, **Refund returned items** uses
the same cancel endpoint with an exact `cancelAmount` and the durable partial
refund UUID as `Idempotency-Key`. Shop derives the returned-item amount from
the immutable order prices; staff may add only explicit shipping and tax
allocations within the frozen order components. The adapter requires a
`PARTIAL_CANCELED` response whose completed cancellation, remaining balance,
payment reference, and amount all match. Shop persists provider confirmation
before local completion and does not repeat the return's inventory restoration
or change its shipped fulfillment.

When Shop staff instead use **Settle return postage and refund**, the adapter
accepts only Shop's validated immutable postage snapshot. Merchant
responsibility sends the full returned allocation; customer responsibility
subtracts exactly the quoted same-currency postage. Toss still receives one
positive partial cancellation with the same durable refund UUID. The adapter
rechecks the gross allocation, deduction, responsibility, currency, and net
amount before network I/O. It never creates a separate/off-session charge or
chooses who is responsible; automatic and jurisdictional policy remain outside
this package.

Shop matches those snapshots to its durable full/return-refund records without
repeating compensation. A previously unknown single full cancellation safely
closes an unshipped fulfillment and restores tracked inventory; an unknown
partial or multi-cancellation snapshot remains PII-free manual review and
blocks shipment/refund mutation. Disputes, chargebacks, initiating repeated or
non-return partial refunds, separate postage charges, virtual accounts, billing,
settlement, exchanges, tax, shipping, and carrier integrations remain separate
contracts.
