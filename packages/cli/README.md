# create-nexpress

Scaffolder CLI for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS.

## Usage

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup    # browser env wizard: DB, NP_SECRET, storage, migrations
pnpm dev
```

Every scaffold ships the six built-in themes (`default`, `community`,
`magazine`, `portfolio`, `storefront`, `docs`) along with example collections
and plugins. The active theme and whether to seed sample content are picked in the
first-boot admin setup wizard at [`/admin/setup`](http://localhost:3000/admin/setup),
not at scaffold time.

The default Shop plugin includes products, categories, bounded guest/member
carts at `/shop/cart`, owner-scoped 15-minute checkout intents, 24-hour private
order drafts, durable `pending-payment` order references, and tracked-inventory
reservations. Intents and drafts retain the cart; the first durable order commit
atomically consumes only its exact source cart, and an idempotent replay never
touches a newer cart. After an order leaves `pending-payment`, its owner may
explicitly re-add current public product and enabled-variant lines with current
names/prices and bounded per-line added/skipped outcomes; current cart coupons
stay while old order pricing, promotion, delivery, tax, reservation, and PII do
not return. Payment processing is disabled by default; projects may register
a build-time provider adapter for bounded owner-scoped attempts, server-side
confirmation, exact verified callbacks, idempotent paid or failed transitions,
atomic reservation consumption or release, and optional audited full refunds
with safe inventory compensation. Shipped orders also expose owner-scoped
item-level return intake and audited receipt inventory without implying a
payment refund or carrier booking. The bundled
`@nexpress/shop-payment-toss` adapter supplies a Toss Payments v2 browser/server
flow plus exact full cancellation when explicitly installed and configured. Order
customer/shipping values live in a separate private sidecar and are physically
deleted on cancellation or the 24-hour deadline; commercial snapshots are
normally purged after 365 days. Non-terminal packing work is the narrow
external-effect exception described below and does not extend private-data
retention.

Order transitions also stage a PII-free owner timeline and a durable
transactional notification outbox. Member inbox delivery respects the shared
kind preference; direct email uses a maximum-24-hour private recipient sidecar
that is deleted after success. Configure the normal NexPress email adapter to
deliver email; the default noop adapter suppresses this channel without
printing recipient PII.

Projects may independently register paired Shop packing-work create/cancel
methods with `createShop({ packing: { adapter } })`. The provider receives only
exact PII-free outbound or replacement lines and prepared parcels behind stable
operation UUIDs; Shop performs provider I/O outside transactions and durably
reconciles confirmation. V1 permits exactly one durable work per target/order.
Shop does not impose an adapter-call timeout, so every adapter network
operation needs its own finite bound; timeout or transport ambiguity remains a
stable retryable `pending` / `cancel-pending` intent.
Cancellation must permanently dominate delayed or retried creation for the
same work/cancellation UUIDs, and Shop retains that `cancelled` tombstone until
order cleanup. Only a cancelled tombstone that was never attached to a shipment
reopens manual parcel, carrier, refund, or replacement-inventory fallback.
Before verified tracking, an attached cancellation may unwind only by
cancelling its exact carrier shipment. After tracking, carrier cancellation and
automatic inventory restock fail closed; only exact booked shipment completion
may proceed, and its packing conflict remains diagnosed and retained. A WMS
cancellation started before tracking may still retry, reconcile, or finish its
local transition afterward under the same cancellation UUID. PII-free Admin
diagnostics remain visible after adapter removal. Stored `provider-confirmed`
and `cancel-confirmed` transitions finish locally without the adapter; any
remaining provider create, cancel, or reconciliation I/O requires the original
adapter. Any relationship-nonterminal work—including a `cancelled` shipment
attachment whose exact carrier compensation is unfinished—keeps its commercial
source order, including a member-linked owner segment, past 365 days until an exact local transition is
finalized, provider reconciliation completes under its stable UUID, exact
`active` work is consumed by the existing manual ship path, or site deletion
removes the tenant.
No generic override terminalizes `pending` or `manual-review`; private data
still expires normally. An optional `verifyPackingStatusWebhook` authenticates
exact raw WMS callbacks, while optional `readPackingStatus` adds lease-safe,
cursor-fair scheduled and direct-staff polling with bounded backoff. Both feed
monotonic PII-free `accepted | picking | failed | packed` evidence and
conflict-safe receipts.
Packed evidence never completes shipment or consumes work. This capability
does not add picking/bin/worker, address/rate/label, material-inventory,
authoritative completion policy, or provider-specific WMS protocols.
Without the adapter, existing manual Shop flows remain unchanged.

`create-nexpress` writes both `.env.example` and `.env` for you. Use the
setup wizard to confirm the DB connection, generate or accept the auth
secret, run migrations, create the first admin, pick a theme, and optionally
seed starter content.

The site runs at [`localhost:3000`](http://localhost:3000) and the admin
panel is at [`localhost:3000/admin`](http://localhost:3000/admin).

## What you get

A Next.js 16 App Router project with:

- `src/collections/` — example collections (posts, pages) using
  `defineCollection()`
- `src/nexpress.config.ts` — site config (storage, auth, plugins)
- `src/db/generated/` — Drizzle schema generated from collections
- `src/app/(site)` — public site routes with the catch-all `[[...slug]]`
- `src/app/(admin)/admin` — login + protected admin shell
- `src/app/api/` — REST endpoints (rate-limited, CSRF-enforced via `proxy.ts`)
- `docker/docker-compose.yml` — Postgres 16 plus Mailpit, with a
  project-specific host port to avoid collisions between scaffolds
- `.env.example` / `.env` — every env var the project actually reads

## Prerequisites

- Node ≥ 20
- pnpm 10.33
- Docker (for the bundled Postgres) **or** any Postgres ≥ 14 reachable
  via `DATABASE_URL`

## Next steps after scaffolding

- Run the first-boot wizard: `pnpm run setup`
- Start the site: `pnpm dev`, then open `/admin`
- Publish your first page or post from the admin
- Plan the deploy target: `pnpm run deploy:plan -- --target vercel --brief --no-color`
- Apply production migrations: `pnpm db:migrate`
- Run the pre-deploy gate: `pnpm run ops:preflight -- --target vercel --brief --no-color`
- Capture release evidence: `pnpm run ops:release -- check --target vercel --json`
- Verify after deploy: `pnpm run ops:release -- verify --url https://your-domain.example --json`
- Deploy on Vercel: push your scaffold to GitHub, then import it from
  [Vercel New Project](https://vercel.com/new?utm_source=nexpress&utm_campaign=oss)
- Add a collection: edit `src/collections/<name>.ts`, run `pnpm db:generate && pnpm db:migrate`
- Run `pnpm typecheck` or `pnpm build` from a clean clone; both commands
  regenerate ignored collection code before TypeScript or Next.js starts
- Author a local theme: `pnpm exec nexpress create theme mybrand --workspace`
- Read [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- Read [deployment.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md) — Docker, Vercel, Fly.io, Render, Railway

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [Issues](https://github.com/nexpress-cms/nexpress/issues)

## License

MIT
