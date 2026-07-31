# @nexpress/shop-payment-toss

Toss Payments v2 integration for `@nexpress/plugin-shop`. The package exports
an adapter rather than a standalone NexPress plugin: Shop owns orders,
inventory, attempts, and Admin diagnostics, while this package owns the Toss
browser SDK handoff, secret-key confirmation, and query-verified webhook
projection.

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
provider idempotency key.

Register the Shop raw webhook URL
`/api/plugins/shop/payments/webhook` as a Toss
`PAYMENT_STATUS_CHANGED` endpoint. Toss general-payment webhooks are verified
by querying the payment with the secret key; unsupported or mismatched payloads
fail closed, while authenticated non-terminal status updates are acknowledged
without changing the order.

Return query parameters never mark an order paid. Only a successful,
server-authenticated confirmation response or a query-verified terminal
webhook can emit the canonical Shop payment event. Ambiguous provider errors
leave the order pending. Refunds, reversals, virtual accounts, billing,
settlement, tax, shipping, and fulfillment are separate contracts.
