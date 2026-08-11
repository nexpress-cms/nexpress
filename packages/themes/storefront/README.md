# @nexpress/theme-storefront

A brand and catalog-ready NexPress theme.

The theme has no dependency on `@nexpress/plugin-shop`. It works as a complete
page, article, and member-capable site on the generic NexPress contracts. When
the Shop plugin is installed, the theme enhances its documented `np-shop`
tokens, classes, data attributes, and optional homepage blocks without
importing the plugin package.

Generated projects include the theme in `defaultThemes`. Activate it from
Admin → Appearance. It seeds a brand home, About/shipping pages, navigation,
and journal entries without requiring Shop data.

Optional Shop integration consumes only documented public CSS hooks. See the
[live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md).
When Forum-backed product inquiries are also enabled, Storefront enhances the
stable `[data-np-forum-context-questions]` hook without importing Forum or
requiring either plugin.
The same independent integration styles Shop's optional
`[data-np-shop-surface="wishlist"]`, `[data-np-shop-wishlist-action]`, and
`[data-np-shop-restock-alert]` hooks; Storefront does not own wishlist or
restock-alert data, routes, delivery, or authentication.
Order-detail cart rebuilding is styled only through the optional
`[data-np-shop-order-readd]` hook. Shop continues to own order authorization,
current-catalog validation, cart revisions, and partial added/skipped results;
the theme never reads order data or imports Shop.
It also enhances `[data-np-shop-return-postage-status]` when Shop exposes optional
return-postage quoting; the theme remains usable without Shop and owns no
carrier, quote, selection, payment, or return policy.
When Shop later projects a completed quote-backed refund, Storefront styles the
independent `[data-np-shop-return-postage-settlement]` hook without deciding the
merchant/customer responsibility or changing the refund amount.
Same-item replacement state is enhanced independently through
`[data-np-shop-exchange]`, while the short-lived owner replacement-address form
and its non-PII status use `[data-np-shop-exchange-destination]`; Storefront owns
presentation only and does not import Shop, retain/read addresses, decide
eligibility, consume inventory, or dispatch exchange operations.
Optional provider-booked replacement tracking is enhanced through the separate
`[data-np-shop-exchange-carrier-booking]` hook; the theme remains independent
of carrier configuration, booking, cancellation, and reconciliation.
