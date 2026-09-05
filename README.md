# OwnTheInternet

Brands compete to own a word — and a position — on one global leaderboard.

```
WORD + BRAND + BID → PAYMENT → GLOBAL RANK → VISIBILITY + CLICKS → SHARE → TAKEOVER → RECLAIM
```

Owning a word here is **temporary paid placement on this platform**. It is not legal ownership
of a word, a trademark, a domain or any intellectual property.

## Architecture

One Next.js 15 app and one Postgres database. That is the whole system.

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 App Router (TypeScript) | Pages, API routes and the webhook in one deployable |
| Data | PostgreSQL 16 + Prisma | Row locks make the takeover race correct; migrations are checked in |
| Payments | Provider interface + Stripe | One file to swap processors; a mock provider for local dev |
| Styling | Tailwind v4 | No component library to maintain |
| Tests | Vitest | Unit tests for rules, integration tests against real Postgres |

There is no queue, no cache, no separate backend service and no microservices. One founder can
hold this in their head.

### Where the money rules live

- `src/lib/pricing.ts` — starting price, takeover premium, "does this bid win".
- `src/lib/ownership.ts` — **the only code that changes a word's value, owner or rank.**
- `src/app/api/webhooks/payments/route.ts` — the only caller of the above.

Ranking is `current value DESC`, ties broken by the earlier confirmed ownership. Rank changes
only after a payment is confirmed; nothing is reserved while a checkout is open.

### Payment correctness

1. **Verified.** The webhook signature is checked against the raw request body. Bad signature → 400.
2. **Idempotent.** Two independent guards: a unique `(provider, eventId)` on `WebhookEvent`, so a
   redelivery aborts the transaction; and a unique `paymentId` on `Ownership`, so one payment can
   never produce two ownerships.
3. **Serialised.** Confirmation takes `SELECT … FOR UPDATE` on the word row, so simultaneous
   takeovers of the same word are ordered and exactly one wins.
4. **Re-checked late.** The bid is compared against the *live* value at confirmation time, not the
   value shown at checkout. A bid that no longer wins does not get the word.
5. **Refunded, never pocketed.** A captured payment that loses the race is refunded through the
   provider. If the refund call fails, the payment sits in `REFUND_PENDING` and appears in `/admin`.

## Running locally

Requires Node 22+ and PostgreSQL 16.

```bash
npm install
cp .env.example .env          # then edit — see below
createdb owntheinternet
npm run db:migrate            # creates the schema
npm run db:seed               # optional: obviously-fake sample rows
npm run dev                   # http://localhost:3000
```

With `PAYMENT_PROVIDER=mock` there is no external service and no card details: checkout goes to an
in-app sandbox page whose Pay/Cancel buttons post a **signed event to the real webhook endpoint**,
so local development exercises the production confirmation path.

### Tests

```bash
createdb owntheinternet_test
cp .env.test.example .env.test   # DATABASE_URL must point at the *test* database
npm test
```

The suite refuses to run unless the database name contains `test`. Migrations are applied
automatically before the first test.

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `CLICK_HASH_SALT` | **yes** | — | Salt for hashing visitor IP+UA. Long random string. Raw IPs are never stored |
| `ADMIN_TOKEN` | **yes** | — | Password for `/admin`. Long random string, min 8 chars |
| `NEXT_PUBLIC_SITE_URL` | **yes in prod** | `http://localhost:3000` | Canonical origin; used for checkout redirects, OG tags and the sitemap |
| `PAYMENT_PROVIDER` | no | `mock` | `stripe` or `mock`. **`mock` is refused in production** unless `ALLOW_MOCK_PAYMENTS=true` |
| `STRIPE_SECRET_KEY` | with Stripe | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | — | Signing secret for the webhook endpoint |
| `STRIPE_CURRENCY` | no | `usd` | Checkout currency |
| `STARTING_PRICE_CENTS` | no | `1000` | Price of an unclaimed word ($10) |
| `TAKEOVER_INCREMENT_PERCENT` | no | `5` | Minimum premium to take an owned word |
| `MAX_AMOUNT_CENTS` | no | `10000000` | Ceiling on a single claim ($100,000) |
| `CLICK_DEDUPE_WINDOW_MINUTES` | no | `30` | Repeat clicks by one visitor inside this window are not counted |

### Connecting Stripe

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_SITE_URL`.
2. Add a webhook endpoint in the Stripe dashboard pointing at
   `https://<your-domain>/api/webhooks/payments`, subscribed to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`.
3. Put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Locally: `stripe listen --forward-to localhost:3000/api/webhooks/payments`.

Until these are set, `PAYMENT_PROVIDER=stripe` fails loudly at the first checkout rather than
pretending to work.

## Deploying

```bash
npm run db:deploy   # apply migrations
npm run build
npm start
```

Run **one instance** to start. The rate limiter is in-process (`src/lib/ratelimit.ts`); if you
scale horizontally, move it to Redis — the call sites do not change. Everything else is stateless
and safe to scale.

Also schedule `npm run reconcile-refunds` every 10-15 minutes (cron, or your platform's scheduled
jobs). See **Refunds** below for what it does and why it exists.

## Metrics

`/admin` shows revenue, confirmed payments, claimed words, paid placements, takeovers, repeat
buyers, valid outbound clicks and average ownership value — all computed from real rows.

Visitors, claim conversion and referral traffic are **not** shown, because they need a web
analytics tool. Add one (Plausible, Fathom, GA) to `src/app/layout.tsx` if you want them.

## Refunds

A payment that loses the takeover race (`confirmPayment` returns `outcome: 'lost'`) has already
captured real money. The webhook handler tries to refund it immediately, in the same request. If
that call fails — or the process dies between marking it `REFUND_PENDING` and calling the
provider — the payment is stuck with money behind it and no word.

Two ways to clear it, both calling the same `reconcileRefund` in `src/lib/refunds.ts`:

- **`/admin`** lists every `REFUND_PENDING` payment with a **Retry** button (and **Retry all**).
  Safe to click more than once — a payment that already refunded is a no-op.
- **`npm run reconcile-refunds`** does the same thing for every stuck payment, from the command
  line or a cron job. It exits non-zero if anything is still stuck afterwards, so a scheduler's
  own failure alerting picks it up without extra plumbing.

If a payment keeps failing after a retry, refund it directly in your payment provider's dashboard
and mark it in `/admin`.

## Anti-abuse

- **Word normalisation** and a reserved/prohibited list (`src/lib/word.ts`).
- **Destination URL validation** blocking non-http schemes, embedded credentials and
  internal/loopback hostnames (`src/lib/url.ts`).
- **SSRF-safe outbound fetch** (`src/lib/safe-fetch.ts`) for the one server-side request driven
  by a user-supplied URL (fetching a title/description at claim time). Text validation alone
  cannot catch a public hostname that resolves to an internal address ("DNS rebinding") — a
  domain can pass every check in `validateDestinationUrl` and still resolve to `127.0.0.1` or a
  cloud metadata endpoint. `safeFetch` uses a custom DNS lookup that rejects private/internal
  addresses at the moment a connection is actually made, not before, so the address that is
  checked is the exact address connected to.
- **Canonical brand identity.** `Owner` is keyed by domain (`www.` stripped, lowercased), not
  minted fresh per checkout — the same brand bidding on five words, or bidding again later, is
  one row. This is also what makes the repeat-buyer metric a plain count rather than a guess.
- IP rate limiting on checkout and on the admin sign-in form.
- Bot filtering and per-visitor click dedupe.
- Signature-verified, idempotent payments (see **Payment correctness** above).
- Word/brand blocking in `/admin`, including retrying a stuck refund.

## Not built (deliberately)

Accounts, subscriptions, timed auctions, categories, notifications, share-card generation,
recommendations, conversion attribution and founder analytics are all out of MVP scope.
