# @nexpress/shop-payment-toss

Toss Payments v2 integration for `@nexpress/plugin-shop`. The package exports
an adapter rather than a standalone NexPress plugin: Shop owns orders,
inventory, attempts, and Admin diagnostics, while this package owns the Toss
browser SDK handoff, secret-key confirmation, query-verified webhook
projection, and idempotent full-payment cancellation.

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
without changing the order.

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

Reversals, virtual accounts, billing, settlement, partial refunds, returns,
tax, shipping, and carrier integrations remain separate contracts.
